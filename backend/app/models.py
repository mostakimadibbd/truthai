"""Free-model catalogue and attempt ordering.

A direct port of lib/server/models.ts + the free-only guard from
lib/server/openrouter.ts. The owner's OpenRouter account has NO
credit, so only free models may ever be called:

  * a catalogue entry is free iff its id ends with ":free" or its
    prompt AND completion prices are both exactly "0";
  * the attempt chain is additionally passed through
    `free_only_attempts`, which drops anything that is not the
    `openrouter/free` router or a ":free" variant — at the single
    choke point every completion flows through, so a paid call is
    structurally impossible even if a caller is buggy.
"""
from __future__ import annotations

import time

import httpx

from .config import settings

AUTO_MODEL_ID = "openrouter/free"

# Curated free models, strongest first (mirrors FALLBACK_MODELS).
FALLBACK_MODELS: list[dict] = [
    # Refreshed 2026-11-17 against the live catalogue (mirrors
    # lib/server/models.ts): the previous curated set had fully
    # rotated out of the free tier.
    {"id": "nvidia/nemotron-3-ultra-550b-a55b:free", "name": "Nemotron 3 Ultra 550B (Free)"},
    {"id": "google/gemma-4-31b-it:free", "name": "Gemma 4 31B (Free)"},
    {"id": "inclusionai/ling-3.2-flash:free", "name": "Ling 3.2 Flash (Free)"},
    {"id": "nvidia/nemotron-3.5-super-vl:free", "name": "Nemotron 3.5 Super VL (Free)"},
    {"id": "google/gemma-4-26b-a4b-it:free", "name": "Gemma 4 26B (Free)"},
    {"id": "cohere/north-mini-code:free", "name": "North Mini Code (Free)"},
]

_cache: dict = {"at": 0.0, "models": []}
_CACHE_TTL_SECONDS = 300


def is_free_entry(model: dict) -> bool:
    model_id = model.get("id", "")
    if model_id.endswith(":free"):
        return True
    pricing = model.get("pricing") or {}
    return pricing.get("prompt") == "0" and pricing.get("completion") == "0"


# Vision capability for the curated fallbacks (mirrors the
# capabilities column in lib/server/models.ts — the live
# catalogue carries it in architecture.input_modalities, the
# curated entries are static).
_FALLBACK_CAPABILITIES: dict[str, list[str]] = {
    "google/gemma-4-31b-it:free": ["text", "vision"],
    "nvidia/nemotron-3.5-super-vl:free": ["text", "vision"],
    "google/gemma-4-26b-a4b-it:free": ["text", "vision"],
}


def capabilities_for(model: dict) -> list[str]:
    """['text'] plus 'vision' when the model accepts image
    input (parity with capabilitiesFor in lib/server/models.ts)."""
    capabilities = ["text"]
    architecture = model.get("architecture") or {}
    modalities = architecture.get("input_modalities") or []
    if "image" in modalities:
        capabilities.append("vision")
    elif "vision" in _FALLBACK_CAPABILITIES.get(model.get("id", ""), []):
        capabilities.append("vision")
    return capabilities


def model_has_vision(models: list[dict], model_id: str) -> bool:
    """Parity with modelHasVision in lib/server/models.ts."""
    for model in models:
        if model.get("id") == model_id:
            return "vision" in capabilities_for(model)
    return False


def pick_free_vision_model(models: list[dict]) -> dict | None:
    """The vision switch for image turns (parity with
    pickFreeVisionModel): a curated fallback that can see wins
    over the rest of the free vision catalogue."""
    vision = [
        model
        for model in models
        if model.get("id") != AUTO_MODEL_ID
        and "vision" in capabilities_for(model)
    ]
    if not vision:
        return None
    vision_ids = {model["id"] for model in vision}
    for fallback in FALLBACK_MODELS:
        if fallback["id"] in vision_ids:
            return next(m for m in vision if m["id"] == fallback["id"])
    return vision[0]


async def get_free_models(force: bool = False) -> list[dict]:
    """Live free catalogue merged with the curated fallbacks."""
    now = time.time()
    if not force and _cache["models"] and now - _cache["at"] < _CACHE_TTL_SECONDS:
        return _cache["models"]
    live: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(f"{settings.openrouter_base_url}/models")
            response.raise_for_status()
            data = response.json().get("data", [])
            live = [m for m in data if isinstance(m, dict) and is_free_entry(m)]
    except Exception:
        live = []
    merged: dict[str, dict] = {}
    for model in live:
        merged[model["id"]] = {
            "id": model["id"],
            "name": model.get("name") or model["id"],
            # Kept for capability detection (vision routing reads
            # architecture.input_modalities via capabilities_for).
            "architecture": model.get("architecture") or {},
        }
    for model in FALLBACK_MODELS:
        merged.setdefault(model["id"], model)
    models = sorted(merged.values(), key=lambda m: m["name"])
    if models:
        _cache["at"] = now
        _cache["models"] = models
    return models or list(FALLBACK_MODELS)


async def is_allowed_free_model(model_id: str) -> bool:
    if model_id == AUTO_MODEL_ID:
        return True
    models = await get_free_models()
    return any(m["id"] == model_id for m in models)


def model_attempt_order(requested: str) -> list[str]:
    """requested -> Auto router -> three curated fallbacks, deduped."""
    order: list[str] = []
    for candidate in [
        requested,
        AUTO_MODEL_ID,
        FALLBACK_MODELS[0]["id"],
        FALLBACK_MODELS[1]["id"],
        FALLBACK_MODELS[2]["id"],
    ]:
        if candidate not in order:
            order.append(candidate)
    return order


def web_model_attempt_order(requested: str) -> list[str]:
    """Web-carrying turns: strong curated models first, router last.

    A refusal is an HTTP 200, so the fallback chain cannot correct
    a weak router pick after the fact (mirrors the TS rationale).
    """
    order: list[str] = []
    for candidate in [
        FALLBACK_MODELS[0]["id"],
        FALLBACK_MODELS[1]["id"],
        FALLBACK_MODELS[2]["id"],
        requested,
        AUTO_MODEL_ID,
    ]:
        if candidate not in order:
            order.append(candidate)
    return order


def free_only_attempts(attempts: list[str]) -> list[str]:
    """THE free-only choke point (see module docstring)."""
    kept = [a for a in attempts if a == AUTO_MODEL_ID or a.endswith(":free")]
    dropped = [a for a in attempts if a not in kept]
    if dropped:
        print(f"Free-only guard dropped non-free model attempts: {', '.join(dropped)}")
    return kept or [AUTO_MODEL_ID]


# User-facing model modes (parity with lib/model-modes.ts): the
# picker sends a mode id, never a provider name. Each mode prefers
# a provider inside the fallback chain.
MODEL_MODE_PROVIDERS: dict[str, str | None] = {
    "fast": "groq",
    "thinking": None,
    "lightweight": "cloudflare",
}


def is_model_mode(value) -> bool:
    return isinstance(value, str) and value in MODEL_MODE_PROVIDERS

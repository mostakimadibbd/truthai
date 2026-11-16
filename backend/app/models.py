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
    {"id": "meta-llama/llama-3.3-70b-instruct:free", "name": "Llama 3.3 70B (Free)"},
    {"id": "google/gemma-3-27b-it:free", "name": "Gemma 3 27B (Free)"},
    {"id": "deepseek/deepseek-chat-v3-0324:free", "name": "DeepSeek V3 (Free)"},
    {"id": "qwen/qwen3-235b-a22b:free", "name": "Qwen3 235B (Free)"},
    {"id": "mistralai/mistral-small-3.1-24b-instruct:free", "name": "Mistral Small 3.1 (Free)"},
]

_cache: dict = {"at": 0.0, "models": []}
_CACHE_TTL_SECONDS = 300


def is_free_entry(model: dict) -> bool:
    model_id = model.get("id", "")
    if model_id.endswith(":free"):
        return True
    pricing = model.get("pricing") or {}
    return pricing.get("prompt") == "0" and pricing.get("completion") == "0"


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
    """requested -> Auto router -> two curated fallbacks, deduped."""
    order: list[str] = []
    for candidate in [
        requested,
        AUTO_MODEL_ID,
        FALLBACK_MODELS[0]["id"],
        FALLBACK_MODELS[1]["id"],
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

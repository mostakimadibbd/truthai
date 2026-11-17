"""OpenRouter completion with the production fallback policy.

Port of lib/server/openrouter.ts fetchChatCompletionWithFallback:
attempts run in order through the free-only guard; each attempt
has a connect timeout (headers only, so a long stream is never
killed mid-generation); 429/5xx and client-error statuses that
mean "this model can't serve it" (400/404/413/422) advance the
chain with Retry-After-aware backoff capped at 5s; 401/402/403
return immediately (they indict the request/account, not the
model). Streaming is consumed here and re-published by the caller
through a callback, so this module stays transport-only.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from typing import Awaitable, Callable

import httpx

from .config import cloudflare_account_id, provider_api_key, provider_configured, settings
from .models import free_only_attempts

RETRYABLE_STATUSES = {400, 404, 413, 422, 429, 500, 502, 503, 504}


class AttemptsExhausted(Exception):
    def __init__(self, last_status: int, last_body: str, retry_after: str | None):
        super().__init__(f"All model attempts failed (last status {last_status})")
        self.last_status = last_status
        self.last_body = last_body
        self.retry_after = retry_after



# Cross-provider free tiers (mirror of the TS provider layer in
# lib/server/openrouter.ts): when a free-tier key for another
# provider is configured, the chain extends past OpenRouter —
# a separate quota pool catches turns when OpenRouter's ~50/day
# no-credit quota is dry. Hard model allowlists, free tiers only.
CROSS_PROVIDERS: list[dict] = [
    {
        "provider": "gemini",
        "url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        "env_keys": ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY"],
        "models": ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
        "vision_models": ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    },
    {
        "provider": "groq",
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "env_keys": ["GROQ_API_KEY"],
        "models": ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"],
    },
    {
        "provider": "requesty",
        "url": "https://router.requesty.ai/v1/chat/completions",
        "env_keys": ["REQUESTY_API_KEY"],
        "models": [
            "nvidia/nemotron-3-ultra-550b-a55b",
            "google/gemma-4-31b-it",
            "nvidia/nemotron-3.5-lightning-30b-a3b",
        ],
        "vision_models": ["google/gemma-4-31b-it"],
    },
    {
        "provider": "sambanova",
        "url": "https://api.sambanova.ai/v1/chat/completions",
        "env_keys": ["SAMBANOVA_API_KEY"],
        "models": ["DeepSeek-V3.1", "Meta-Llama-3.3-70B-Instruct", "gpt-oss-120b"],
    },
    {
        "provider": "nvidia",
        "url": "https://integrate.api.nvidia.com/v1/chat/completions",
        "env_keys": ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"],
        "models": [
            "meta/llama-3.3-70b-instruct",
            "openai/gpt-oss-120b",
            "deepseek-ai/deepseek-v4-flash",
        ],
    },
    {
        # Cloudflare Workers AI: the URL embeds the account id, so
        # the target builder substitutes it; the provider is skipped
        # unless BOTH the token and the account id are configured.
        "provider": "cloudflare",
        "url": "https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1/chat/completions",
        "env_keys": ["CLOUDFLARE_API_TOKEN"],
        "models": [
            "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
            "@cf/openai/gpt-oss-120b",
            "@cf/meta/llama-4-scout-17b-16e-instruct",
        ],
        "vision_models": ["@cf/meta/llama-4-scout-17b-16e-instruct"],
    },
]


def provider_presence() -> dict[str, bool]:
    """Which cross-provider API keys are configured (presence only —
    values never leave the process). Surfaced on the token-gated
    /health so key setup can be verified without console access."""
    presence = {
        spec["provider"]: provider_configured(spec["env_keys"])
        for spec in CROSS_PROVIDERS
    }
    if "cloudflare" in presence:
        presence["cloudflare"] = bool(
            presence["cloudflare"] and cloudflare_account_id()
        )
    return presence


def cross_provider_targets(vision_only: bool = False) -> list[dict]:
    targets: list[dict] = []
    for spec in CROSS_PROVIDERS:
        api_key = provider_api_key(spec["env_keys"])
        if not api_key:
            continue
        url = spec["url"]
        if "{account}" in url:
            account = cloudflare_account_id()
            if not account:
                continue
            url = url.replace("{account}", account)
        models = spec.get("vision_models", []) if vision_only else spec["models"]
        for model in models:
            targets.append(
                {
                    "provider": spec["provider"],
                    "model": model,
                    "label": f"{spec['provider']}/{model}",
                    "url": url,
                    "api_key": api_key,
                }
            )
    return targets


def build_targets(openrouter_attempts: list[str], vision_only: bool = False, providers_first: bool = False, preferred_provider: str | None = None) -> list[dict]:
    targets = [
        {
            "provider": "openrouter",
            "model": model,
            "label": model,
            "url": f"{settings.openrouter_base_url}/chat/completions",
            "api_key": settings.openrouter_api_key,
        }
        for model in openrouter_attempts
    ]
    cross = cross_provider_targets(vision_only)
    ordered = cross + targets if providers_first else targets + cross
    if preferred_provider:
        ordered = [t for t in ordered if t["provider"] == preferred_provider] + [
            t for t in ordered if t["provider"] != preferred_provider
        ]
    return ordered

_shared: httpx.AsyncClient | None = None


def _shared_client() -> httpx.AsyncClient:
    """One pooled client for every upstream call in this process.

    Creating a client per attempt (the old shape) paid a fresh
    TCP + TLS handshake to OpenRouter for every model tried and
    every job. Pooling keeps warm connections alive across
    attempts and across jobs; per-request timeouts still apply.
    """
    global _shared
    if _shared is None or _shared.is_closed:
        _shared = httpx.AsyncClient(
            limits=httpx.Limits(max_connections=32, max_keepalive_connections=16)
        )
    return _shared


_REFUSAL_PATTERNS = [
    r"\bi (?:can'?t|cannot|can not) browse\b",
    r"\bi (?:can'?t|cannot|can not) access the (?:internet|web)\b",
    r"\bi (?:don'?t|do not) have (?:access to )?(?:the )?(?:internet|web|real[- ]?time|browsing)\b",
    r"\bi (?:don'?t|do not) have browsing\b",
    r"\bi'?m unable to (?:browse|access)\b",
    r"\bi am unable to (?:browse|access)\b",
    r"\bas an ai language model\b",
    r"\bno (?:internet|browsing) access\b",
]


def looks_like_refusal(text: str) -> bool:
    """True when a reply opens with an access-denial refusal (the
    weak free-model habit of claiming it cannot browse/reach the
    internet). Parity with the TS chain's looksLikeRefusal."""
    head = text[:400].lower()
    return any(re.search(pattern, head) for pattern in _REFUSAL_PATTERNS)


async def stream_completion(
    attempts: list[str],
    messages: list[dict],
    on_text: Callable[[str], Awaitable[None]],
    max_tokens: int = 4096,
    connect_timeout: float = 25.0,
    providers_first: bool = False,
    preferred_provider: str | None = None,
) -> dict:
    """Stream a completion, calling on_text with the full text so
    far whenever it grows. Returns {model, text, usage} where usage
    is {promptTokens, completionTokens} or None."""
    attempts = free_only_attempts(attempts)
    # Media turns only target cross-provider models that can see
    # images (parity with the TS chain).
    has_images = any(
        isinstance(message.get("content"), list)
        and any(
            isinstance(part, dict) and part.get("type") == "image_url"
            for part in message["content"]
        )
        for message in messages
        if isinstance(message, dict)
    )
    targets = build_targets(attempts, vision_only=has_images, providers_first=providers_first, preferred_provider=preferred_provider)
    last_status = 0
    last_body = ""
    last_retry_after: str | None = None

    for index, target in enumerate(targets):
        model = target["model"]
        if index > 0:
            await asyncio.sleep(min(2.0 * index, 5.0))
        text_parts: list[str] = []
        usage: dict | None = None
        try:
            timeout = httpx.Timeout(connect=connect_timeout, read=None, write=30, pool=30)
            client = _shared_client()
            headers = {
                "Authorization": f"Bearer {target['api_key']}",
                "Content-Type": "application/json",
            }
            if target["provider"] == "openrouter":
                headers["HTTP-Referer"] = "https://truthai-six.vercel.app"
                headers["X-Title"] = "Xyro AI"
            body = {
                "model": model,
                "messages": messages,
                "stream": True,
                "max_tokens": max_tokens,
            }
            if target["provider"] == "openrouter":
                body["usage"] = {"include": True}
            async with client.stream(
                "POST",
                target["url"],
                headers=headers,
                json=body,
                timeout=timeout,
            ) as response:
                if response.status_code != 200:
                    body = (await response.aread()).decode("utf-8", "replace")[:2000]
                    last_status = response.status_code
                    last_body = body
                    last_retry_after = response.headers.get("retry-after")
                    retryable = response.status_code in RETRYABLE_STATUSES or (
                        target["provider"] != "openrouter"
                        and response.status_code in {401, 402, 403}
                    )
                    if retryable:
                        continue
                    raise AttemptsExhausted(
                        response.status_code, body, last_retry_after
                    )
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[len("data:"):].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        chunk = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    choices = chunk.get("choices") or []
                    if choices:
                        delta = choices[0].get("delta") or {}
                        piece = delta.get("content")
                        if isinstance(piece, str) and piece:
                            text_parts.append(piece)
                            await on_text("".join(text_parts))
                    raw_usage = chunk.get("usage")
                    if isinstance(raw_usage, dict):
                        usage = {
                            "promptTokens": int(raw_usage.get("prompt_tokens") or 0),
                            "completionTokens": int(
                                raw_usage.get("completion_tokens") or 0
                            ),
                        }
            text = "".join(text_parts)
            if text.strip():
                return {"model": target["label"], "text": text, "usage": usage}
            last_status = 502
            last_body = "Model returned an empty response."
        except httpx.HTTPError as error:
            last_status = 0
            last_body = f"Network error: {error}"[:2000]
            continue
    raise AttemptsExhausted(last_status, last_body, last_retry_after)

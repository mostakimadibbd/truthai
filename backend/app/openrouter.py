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
import time
from typing import Awaitable, Callable

import httpx

from .config import settings
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
    },
    {
        "provider": "groq",
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "env_keys": ["GROQ_API_KEY"],
        "models": ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.1-8b-instant"],
    },
    {
        "provider": "mistral",
        "url": "https://api.mistral.ai/v1/chat/completions",
        "env_keys": ["MISTRAL_API_KEY"],
        "models": ["mistral-small-latest", "open-mistral-nemo"],
    },
    {
        "provider": "huggingface",
        "url": "https://router.huggingface.co/v1/chat/completions",
        "env_keys": ["HF_TOKEN", "HUGGINGFACE_API_KEY"],
        "models": ["Qwen/Qwen3-235B-A22B", "meta-llama/Llama-3.3-70B-Instruct"],
    },
]


def cross_provider_targets() -> list[dict]:
    targets: list[dict] = []
    for spec in CROSS_PROVIDERS:
        api_key = next(
            (os.environ.get(name, "").strip() for name in spec["env_keys"]
             if os.environ.get(name, "").strip()),
            "",
        )
        if not api_key:
            continue
        for model in spec["models"]:
            targets.append(
                {
                    "provider": spec["provider"],
                    "model": model,
                    "label": f"{spec['provider']}/{model}",
                    "url": spec["url"],
                    "api_key": api_key,
                }
            )
    return targets


def build_targets(openrouter_attempts: list[str]) -> list[dict]:
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
    return targets + cross_provider_targets()

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


async def stream_completion(
    attempts: list[str],
    messages: list[dict],
    on_text: Callable[[str], Awaitable[None]],
    max_tokens: int = 4096,
    connect_timeout: float = 25.0,
) -> dict:
    """Stream a completion, calling on_text with the full text so
    far whenever it grows. Returns {model, text, usage} where usage
    is {promptTokens, completionTokens} or None."""
    attempts = free_only_attempts(attempts)
    targets = build_targets(attempts)
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

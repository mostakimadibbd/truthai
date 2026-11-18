"""Usage metering — port of the core writes in
lib/server/analytics.ts recordUsageEvent.

Writes the per-request ledger (usageEvents), the minute and
daily rollups (analytics_minutes, analytics_days,
analytics_user_days), the per-model rollups
(analytics_model_minutes, analytics_model_days), the user's own
usage tab totals (users/{uid}/chatUsage/{day}) and the per-chat
daily rollup (users/{uid}/chatUsageByDay/{day}/chats/{chatId}),
with the same field names and UTC day/minute keys, so the admin
panel and Settings > Usage read backend-executed turns exactly
like locally executed ones. (Until 2026-11-18 the Python writer
skipped the minute and per-model rollups, so delegated turns
were invisible in the panel's 24h/48h ranges and Models card.)
"""
from __future__ import annotations

import datetime
import re


def _day_key(now: datetime.datetime) -> str:
    return now.strftime("%Y-%m-%d")


def _minute_key(now: datetime.datetime) -> str:
    return now.strftime("%Y-%m-%dT%H:%M")


def _sanitize_model_id(model: str) -> str:
    # Mirrors sanitizeModelId in lib/server/analytics.ts.
    return re.sub(r"[^a-zA-Z0-9_-]", "_", model)


def record_usage_event(
    db,
    *,
    uid: str,
    surface: str,
    model: str | None,
    prompt_tokens: int,
    completion_tokens: int,
    chat_id: str | None,
    tokens_estimated: bool,
) -> None:
    from firebase_admin import firestore

    now = datetime.datetime.now(datetime.timezone.utc)
    day = _day_key(now)
    prompt_tokens = max(0, int(prompt_tokens))
    completion_tokens = max(0, int(completion_tokens))
    total = prompt_tokens + completion_tokens
    surface_counter = {
        "chat": "chatRequests",
        "api": "apiRequests",
        "image": "imageRequests",
    }.get(surface, "chatRequests")
    # Increment-based totals (FieldValue.increment in TS). NOTE:
    # firebase_admin.firestore exposes Increment directly — the
    # old FieldValue.increment path does not exist in the current
    # SDK and raised AttributeError on every call, which the job
    # runner swallowed, so delegated turns were never metered
    # until 2026-11-18.
    inc = firestore.Increment
    totals = {
        "requests": inc(1),
        surface_counter: inc(1),
        "promptTokens": inc(prompt_tokens),
        "completionTokens": inc(completion_tokens),
        "totalTokens": inc(total),
        "costUsd": inc(0),
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }

    batch = db.batch()
    batch.set(
        db.collection("usageEvents").document(),
        {
            "uid": uid,
            "surface": surface,
            "model": model,
            "promptTokens": prompt_tokens,
            "completionTokens": completion_tokens,
            "totalTokens": total,
            "costUsd": 0,
            "chatId": chat_id,
            "status": "success",
            "tokensEstimated": tokens_estimated,
            "ts": int(now.timestamp() * 1000),
            "createdAt": firestore.SERVER_TIMESTAMP,
        },
    )
    minute = _minute_key(now)
    batch.set(
        db.collection("analytics_minutes").document(minute),
        {"minute": minute, **totals},
        merge=True,
    )
    batch.set(
        db.collection("analytics_days").document(day),
        {"day": day, **totals},
        merge=True,
    )
    batch.set(
        db.collection("analytics_user_days").document(f"{day}__{uid}"),
        {**totals, "uid": uid, "day": day},
        merge=True,
    )
    if model:
        model_totals = {
            "model": model,
            "requests": inc(1),
            "promptTokens": inc(prompt_tokens),
            "completionTokens": inc(completion_tokens),
            "totalTokens": inc(total),
            "costUsd": inc(0),
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        batch.set(
            db.collection("analytics_model_minutes").document(
                f"{minute}__{_sanitize_model_id(model)}"
            ),
            {"minute": minute, **model_totals},
            merge=True,
        )
        batch.set(
            db.collection("analytics_model_days").document(
                f"{day}__{_sanitize_model_id(model)}"
            ),
            {"day": day, **model_totals},
            merge=True,
        )
    user_ref = db.collection("users").document(uid)
    batch.set(
        user_ref.collection("chatUsage").document(day),
        {
            "promptTokens": inc(prompt_tokens),
            "completionTokens": inc(completion_tokens),
            "totalTokens": inc(total),
            "requests": inc(1),
            "updatedAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )
    if chat_id:
        batch.set(
            user_ref.collection("chatUsageByDay")
            .document(day)
            .collection("chats")
            .document(chat_id),
            {
                "promptTokens": inc(prompt_tokens),
                "completionTokens": inc(completion_tokens),
                "totalTokens": inc(total),
                "replies": inc(1),
                "models": firestore.ArrayUnion([model]) if model else [],
                "updatedAt": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )
    batch.commit()

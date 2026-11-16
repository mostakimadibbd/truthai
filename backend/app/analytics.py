"""Usage metering — port of the core writes in
lib/server/analytics.ts recordUsageEvent.

Writes the per-request ledger (usageEvents), the daily rollups
(analytics_days, analytics_user_days), the user's own usage tab
totals (users/{uid}/chatUsage/{day}) and the per-chat daily
rollup (users/{uid}/chatUsageByDay/{day}/chats/{chatId}), with the
same field names and UTC day keys, so the existing admin console
and Settings > Usage read backend-executed turns unchanged.
"""
from __future__ import annotations

import datetime


def _day_key(now: datetime.datetime) -> str:
    return now.strftime("%Y-%m-%d")


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
    # Increment-based totals (FieldValue.increment in TS).
    inc = firestore.FieldValue.increment
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
    batch.set(db.collection("analytics_days").document(day), totals, merge=True)
    batch.set(
        db.collection("analytics_user_days").document(f"{day}__{uid}"),
        {**totals, "uid": uid, "day": day},
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

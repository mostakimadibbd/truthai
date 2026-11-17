"""Chat job execution — the heart of the durability guarantee.

A job runs entirely inside this service, decoupled from any HTTP
connection: once submitted, the user's browser can close, the
Next.js proxy can die, the network can drop — the job still
finishes and the reply is saved to Firestore, exactly mirroring
the writes app/api/chat/route.ts performs today:

  * users/{uid}/chats/{chatId} title/preview/searchText updates
  * the user + assistant message pair (shared timestamp, reply
    +1ms, assistant starts as status "generating")
  * the live stream node chatStreams/{uid}/{chatId} in RTDB
    ({responseId, messageId, status, text, phase, seq, updatedAt}),
    republished at most every 250ms plus an 8s heartbeat, removed
    when the turn ends
  * the final assistant update (status "complete" + sources), or
    status "failed" with the error recorded in chatErrors
  * usage metering via analytics.record_usage_event

firebase-admin's client is synchronous, so Firestore/RTDB calls
run in a thread pool to keep the event loop free for other jobs.
"""
from __future__ import annotations

import asyncio
import time

from . import analytics, memory as memory_lib, models as model_lib, openrouter, safety

MAX_MESSAGES = 30
MAX_TOTAL_LENGTH = 36_000
LIVE_UPDATE_INTERVAL_SECONDS = 0.25
HEARTBEAT_SECONDS = 8.0

SYSTEM_PROMPT = (
    "You are Xyro AI, a helpful assistant. Answer clearly and "
    "directly, using Markdown when it helps readability."
)


def _now_ms() -> int:
    return int(time.time() * 1000)


async def _run_sync(fn, *args, **kwargs):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))


class ChatJobError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


async def execute_chat_job(job: dict, db, rtdb_ref) -> dict:
    """Run one chat job to completion. Returns the final status
    dict; raises ChatJobError for user-visible failures (already
    persisted onto the assistant message before raising)."""
    from firebase_admin import firestore

    uid: str = job["uid"]
    chat_id: str = job["chatId"]
    user_message_id: str = job["userMessageId"]
    assistant_message_id: str = job["assistantMessageId"]
    response_id: str = job["responseId"]
    content: str = job["content"]

    chat_ref = db.collection("users").document(uid).collection("chats").document(chat_id)
    messages_ref = chat_ref.collection("messages")
    assistant_ref = messages_ref.document(assistant_message_id)
    stream_ref = rtdb_ref(f"chatStreams/{uid}/{chat_id}")

    # --- Load chat + history -------------------------------------
    chat_snap = await _run_sync(chat_ref.get)
    if not chat_snap.exists:
        raise ChatJobError(404, "CHAT_NOT_FOUND", "This conversation no longer exists.")
    chat_data = chat_snap.to_dict() or {}

    existing = await _run_sync(messages_ref.document(user_message_id).get)
    if existing.exists:
        raise ChatJobError(409, "MESSAGE_ALREADY_EXISTS", "This message was already sent.")

    history_snaps = await _run_sync(
        lambda: list(
            messages_ref.order_by("createdAt").limit_to_last(MAX_MESSAGES).stream()
        )
    )
    history: list[dict] = []
    for snap in history_snaps:
        data = snap.to_dict() or {}
        if data.get("status") == "complete" and isinstance(data.get("content"), str):
            history.append({"role": data.get("role", "user"), "content": data["content"]})
    total_length = sum(len(m["content"]) for m in history)
    while total_length > MAX_TOTAL_LENGTH and len(history) > 1:
        total_length -= len(history.pop(0)["content"])

    # --- Resolve the model (free-only) ----------------------------
    # The picker sends a MODE id (fast / thinking / lightweight);
    # a mode resolves to the Auto attempt order plus a preferred
    # provider inside the chain. A specific model id must be on
    # the free list.
    requested = job.get("model")
    open_router_only = job.get("openRouterOnly") is True
    preferred_provider: str | None = None
    if requested and model_lib.is_model_mode(requested):
        effective_model = model_lib.AUTO_MODEL_ID
        preferred_provider = model_lib.MODEL_MODE_PROVIDERS[requested]
    elif requested:
        if not await model_lib.is_allowed_free_model(requested):
            raise ChatJobError(
                400, "INVALID_MODEL", "Choose Fast, Thinking or Lightweight."
            )
        effective_model = requested
    else:
        effective_model = model_lib.AUTO_MODEL_ID

    # --- Write the message pair ----------------------------------
    pair_ms = _now_ms()
    pair_ts = _firestore_ts(pair_ms)
    reply_ts = _firestore_ts(pair_ms + 1)

    def _write_pair():
        batch = db.batch()
        batch.create(
            messages_ref.document(user_message_id),
            {
                "role": "user",
                "content": content,
                "attachmentIds": [],
                "attachments": [],
                "status": "complete",
                "createdAt": pair_ts,
            },
        )
        batch.create(
            assistant_ref,
            {
                "role": "assistant",
                "content": "",
                "attachmentIds": [],
                "attachments": [],
                "status": "generating",
                "inReplyTo": user_message_id,
                "createdAt": reply_ts,
            },
        )
        existing_title = chat_data.get("title") or "New chat"
        proposed = (content[:60].rsplit(" ", 1)[0].strip() or content[:60]) if content else "File conversation"
        title = proposed if existing_title == "New chat" else existing_title
        previous_search = chat_data.get("searchText") or ""
        search_text = f"{previous_search}\n{content}"[-5000:]
        batch.set(
            chat_ref,
            {
                "title": title,
                "searchText": search_text,
                "lastMessagePreview": content[:300],
                "updatedAt": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )
        batch.commit()
        return search_text

    search_text = await _run_sync(_write_pair)

    # --- Stream the completion ------------------------------------
    stream_state = {"seq": 0, "last_publish": 0.0, "text": "", "phase": "thinking"}

    async def publish(force: bool = False) -> None:
        now = time.time()
        if not force and now - stream_state["last_publish"] < LIVE_UPDATE_INTERVAL_SECONDS:
            return
        stream_state["seq"] += 1
        stream_state["last_publish"] = now
        payload = {
            "responseId": response_id,
            "messageId": assistant_message_id,
            "status": "generating",
            "text": memory_lib.live_visible_text(stream_state["text"]),
            "phase": stream_state["phase"],
            "seq": stream_state["seq"],
            "updatedAt": _now_ms(),
        }
        await _run_sync(stream_ref.set, payload)

    async def heartbeat() -> None:
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            try:
                await publish(force=True)
            except Exception:
                pass

    async def on_text(text: str) -> None:
        stream_state["text"] = text
        stream_state["phase"] = "answering"
        await publish()

    # Long-term memory (parity with the TS chat route): recall
    # the user's saved facts as a system block when enabled.
    memory_on = False
    try:
        memory_on = await _run_sync(memory_lib.memory_enabled, db, uid)
        if memory_on:
            facts = await _run_sync(memory_lib.load_memories, db, uid)
            model_messages_extra = memory_lib.memory_system_block(facts)
        else:
            model_messages_extra = None
    except Exception:
        model_messages_extra = None

    model_messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if model_messages_extra:
        model_messages.append({"role": "system", "content": model_messages_extra})
    for message in history:
        model_messages.append({"role": message["role"], "content": message["content"]})
    model_messages.append({"role": "user", "content": content})

    heartbeat_task = asyncio.create_task(heartbeat())
    try:
        await publish(force=True)
        result = await openrouter.stream_completion(
            model_lib.model_attempt_order(effective_model),
            model_messages,
            on_text,
            max_tokens=4096,
            preferred_provider=preferred_provider,
            open_router_only=open_router_only,
        )
        # Refusal gate (parity with the TS chat route): an
        # access-denial refusal is an HTTP 200 the fallback chain
        # cannot correct. When cross-provider keys exist, discard
        # the refusal and re-ask provider-first (Groq / Gemini
        # ahead of OpenRouter); the published text resets first,
        # so the user only sees the replacement answer settle.
        if not open_router_only and openrouter.looks_like_refusal(result["text"]) and not safety.looks_like_safety_refusal(result["text"]) and openrouter.cross_provider_targets():
            stream_state["text"] = ""
            await publish(force=True)
            result = await openrouter.stream_completion(
                model_lib.model_attempt_order(effective_model),
                model_messages,
                on_text,
                max_tokens=4096,
                providers_first=True,
                preferred_provider=preferred_provider,
                open_router_only=open_router_only,
            )
    except openrouter.AttemptsExhausted as error:
        await _fail_turn(
            db, assistant_ref, stream_ref, uid, chat_id,
            error, firestore,
        )
        if error.last_status == 429 and _is_daily_limit(error.last_body):
            raise ChatJobError(
                429,
                "DAILY_FREE_LIMIT",
                "The platform has reached today's free-model limit (the AI "
                "account runs entirely on free models). Free usage resets "
                "at midnight UTC — please try again after then.",
            )
        if error.last_status == 429:
            raise ChatJobError(
                429, "MODEL_BUSY",
                "Free models are busy right now. Please wait a moment and try again.",
            )
        raise ChatJobError(
            503, "MODEL_UNAVAILABLE",
            "The free model service is temporarily unavailable.",
        )
    finally:
        heartbeat_task.cancel()

    # --- Save the finished reply ----------------------------------
    final_text: str = result["text"]
    # Memory capture: strip the hidden markers from the stored
    # reply and persist the facts for future conversations.
    # Delegated turns are plain-text only (no web results, no
    # files), so the web/file capture ban from the TS route
    # cannot trigger here; the sensitive-category filter inside
    # save_memories still applies.
    saved_memories: list[dict] = []
    if memory_on:
        final_text, new_facts = memory_lib.extract_memories(final_text)
        if new_facts:
            try:
                saved_memories = await _run_sync(
                    memory_lib.save_memories, db, uid, new_facts, chat_id
                )
            except Exception:
                saved_memories = []
    # Safety flagging (silent; parity with the TS route): a
    # high-confidence harmful request or a model safety refusal
    # files a flag for admin review. The user is never told and
    # nothing about their experience changes.
    try:
        harmful_category = safety.classify_harmful_request(content)
        if harmful_category:
            await _run_sync(
                safety.write_flag,
                db,
                uid=uid,
                chat_id=chat_id,
                prompt=content,
                category=harmful_category,
                signal="prompt_pattern",
                model=result.get("model"),
            )
        elif safety.looks_like_safety_refusal(final_text):
            await _run_sync(
                safety.write_flag,
                db,
                uid=uid,
                chat_id=chat_id,
                prompt=content,
                category="other",
                signal="model_refusal",
                model=result.get("model"),
            )
    except Exception:
        pass

    usage = result.get("usage")
    tokens_estimated = usage is None
    if tokens_estimated:
        prompt_tokens = sum(len(m["content"]) // 4 + 1 for m in model_messages)
        completion_tokens = max(1, len(final_text) // 4)
    else:
        prompt_tokens = usage["promptTokens"]
        completion_tokens = usage["completionTokens"]

    def _save_final():
        completed = firestore.SERVER_TIMESTAMP
        final_fields = {"content": final_text, "status": "complete", "updatedAt": completed}
        if result.get("provider"):
            final_fields["provider"] = result["provider"]
        if saved_memories:
            final_fields["memoriesSaved"] = saved_memories
        assistant_ref.update(final_fields)
        chat_ref.update(
            {
                "searchText": f"{search_text}\n{final_text}"[-5000:],
                "lastMessagePreview": final_text[:300],
                "updatedAt": completed,
            }
        )

    await _run_sync(_save_final)
    await _run_sync(stream_ref.delete)
    try:
        await _run_sync(
            analytics.record_usage_event,
            db,
            uid=uid,
            surface="chat",
            model=result["model"],
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            chat_id=chat_id,
            tokens_estimated=tokens_estimated,
        )
    except Exception as error:  # metering must never fail the turn
        print(f"Usage metering failed for job in chat {chat_id}: {error}")

    return {
        "status": "complete",
        "model": result["model"],
        "promptTokens": prompt_tokens,
        "completionTokens": completion_tokens,
        "tokensEstimated": tokens_estimated,
    }


def _firestore_ts(ms: int):
    """A concrete timestamp for the message pair (the TS route
    uses Timestamp.now() + 1ms for the reply, not server time, so
    ordering is exact)."""
    import datetime

    return datetime.datetime.fromtimestamp(ms / 1000, tz=datetime.timezone.utc)


def _is_daily_limit(body: str) -> bool:
    lowered = body.lower()
    return "free-models-per-day" in lowered or "daily" in lowered


async def _fail_turn(db, assistant_ref, stream_ref, uid, chat_id, error, firestore) -> None:
    """Persist a failed turn exactly like the TS route: assistant
    message marked failed, stream node removed, error ledgered."""

    def _write():
        try:
            assistant_ref.update(
                {"status": "failed", "updatedAt": firestore.SERVER_TIMESTAMP}
            )
        except Exception:
            pass
        try:
            stream_ref.delete()
        except Exception:
            pass
        try:
            db.collection("chatErrors").document().set(
                {
                    "uid": uid,
                    "chatId": chat_id,
                    "status": error.last_status,
                    "error": (error.last_body or "")[:500],
                    "source": "python-backend",
                    "ts": _now_ms(),
                    "createdAt": firestore.SERVER_TIMESTAMP,
                }
            )
        except Exception:
            pass

    await _run_sync(_write)

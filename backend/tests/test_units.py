"""Unit + lifecycle tests for the Xyro backend.

Run:  python -m pytest tests/ -q     (or: python tests/test_units.py)
No network or Firebase credentials needed: the job lifecycle runs
against in-memory fakes and a stubbed model stream.
"""
from __future__ import annotations

import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("SESSION_SECRET", "test-secret-for-unit-tests")

from app import auth, chatjob, jobs, models, watermark  # noqa: E402
from tests.fakes import FakeFirestore, make_rtdb  # noqa: E402


# --- models ------------------------------------------------------

def test_free_entry_rules():
    assert models.is_free_entry({"id": "x/y:free", "pricing": {"prompt": "1"}})
    assert models.is_free_entry(
        {"id": "x/y", "pricing": {"prompt": "0", "completion": "0"}}
    )
    assert not models.is_free_entry(
        {"id": "x/y", "pricing": {"prompt": "0", "completion": "0.1"}}
    )
    assert not models.is_free_entry({"id": "openai/gpt-5", "pricing": {}})


def test_free_only_guard():
    kept = models.free_only_attempts(
        ["openai/gpt-5", "openrouter/free", "a/b:free", "anthropic/claude"]
    )
    assert kept == ["openrouter/free", "a/b:free"]
    assert models.free_only_attempts(["openai/gpt-5"]) == ["openrouter/free"]


def test_attempt_orders():
    order = models.model_attempt_order("qwen/qwen3-235b-a22b:free")
    assert order[0] == "qwen/qwen3-235b-a22b:free"
    assert order[1] == "openrouter/free"
    assert len(order) == len(set(order))
    web = models.web_model_attempt_order("openrouter/free")
    assert web[-1] == "openrouter/free"
    assert web[0].endswith(":free")


# --- watermark ---------------------------------------------------

def test_watermark_round_trip_c_and_python():
    import random

    random.seed(3)
    buf = bytes(random.randrange(256) for _ in range(50_000))
    for force_python in (False, True):
        original_lib = watermark._lib
        if force_python:
            watermark._lib = None
        try:
            out = watermark.embed(buf, b"xyro:gen-42")
            assert watermark.extract(out) == b"xyro:gen-42"
        finally:
            watermark._lib = original_lib
    try:
        watermark.extract(buf)
        raise AssertionError("clean buffer must not yield a payload")
    except ValueError:
        pass


def test_watermark_cross_engine_compatibility():
    """C-written watermarks must read back through the Python path
    and vice versa (identical frame format)."""
    import random

    random.seed(11)
    buf = bytes(random.randrange(256) for _ in range(50_000))
    if watermark.using_c_core():
        stamped = watermark.embed(buf, b"xyro:cross")
        lib, watermark._lib = watermark._lib, None
        try:
            assert watermark.extract(stamped) == b"xyro:cross"
        finally:
            watermark._lib = lib


# --- auth --------------------------------------------------------

def test_session_cookie_verification():
    import jwt as pyjwt

    now = int(time.time())
    token = pyjwt.encode(
        {
            "sub": "uid123",
            "sid": "sid123",
            "absExp": (now + 3600) * 1000,
            "exp": now + 3600,
        },
        "test-secret-for-unit-tests",
        algorithm="HS256",
    )
    claims = auth.verify_session_cookie(token)
    assert claims == {"uid": "uid123", "sid": "sid123"}
    assert auth.verify_session_cookie(token + "x") is None
    assert auth.verify_session_cookie(None) is None

    expired_abs = pyjwt.encode(
        {
            "sub": "uid123",
            "sid": "sid123",
            "absExp": (now - 10) * 1000,
            "exp": now + 3600,
        },
        "test-secret-for-unit-tests",
        algorithm="HS256",
    )
    assert auth.verify_session_cookie(expired_abs) is None


def test_service_token_and_cookie_parsing():
    auth.settings.service_token = "s3cret"
    assert auth.check_service_token("s3cret")
    assert not auth.check_service_token("wrong")
    assert not auth.check_service_token(None)
    header = "a=1; __Host-xyro_session=tok123; b=2"
    assert auth._cookie_value(header, "__Host-xyro_session") == "tok123"


# --- job lifecycle ------------------------------------------------

async def _lifecycle() -> None:
    db = FakeFirestore()
    rtdb_store: dict = {}
    rtdb_ref = make_rtdb(rtdb_store)

    chat_path = "users/u1/chats/c1"
    db.store[chat_path] = {"title": "New chat", "searchText": ""}

    published: list[str] = []

    async def fake_stream(attempts, messages, on_text, **kwargs):
        assert attempts == models.free_only_attempts(attempts)
        await on_text("Hello ")
        published.append("chunk")
        await on_text("Hello world")
        return {
            "model": "openrouter/free",
            "text": "Hello world",
            "usage": {"promptTokens": 12, "completionTokens": 3},
        }

    original_stream = chatjob.openrouter.stream_completion
    original_meter = chatjob.analytics.record_usage_event
    metered: list[dict] = []
    chatjob.openrouter.stream_completion = fake_stream
    chatjob.analytics.record_usage_event = lambda db_, **kw: metered.append(kw)
    try:
        submitted = jobs.submit_chat_job(
            {
                "uid": "u1",
                "chatId": "c1",
                "userMessageId": "m-user",
                "assistantMessageId": "m-asst",
                "responseId": "r1",
                "content": "Say hello",
                "model": None,
            },
            db,
            rtdb_ref,
        )
        job_id = submitted["jobId"]
        # wait_for_job is the sync-mode path (Vercel): it must
        # resolve with the terminal status.
        waited = await jobs.wait_for_job(job_id, timeout=10)
        assert waited is not None and waited["status"] == "complete", waited
        status = jobs.get_job(job_id, "u1")
        assert status["status"] == "complete", status
        assert status["result"]["model"] == "openrouter/free"

        user_msg = db.store["users/u1/chats/c1/messages/m-user"]
        asst_msg = db.store["users/u1/chats/c1/messages/m-asst"]
        assert user_msg["role"] == "user" and user_msg["status"] == "complete"
        assert asst_msg["content"] == "Hello world"
        assert asst_msg["status"] == "complete"
        assert asst_msg["inReplyTo"] == "m-user"
        assert asst_msg["createdAt"] > user_msg["createdAt"]
        assert db.store[chat_path]["lastMessagePreview"] == "Hello world"
        assert f"chatStreams/u1/c1" not in rtdb_store  # node removed at end
        assert metered and metered[0]["prompt_tokens"] == 12
        assert jobs.get_job(job_id, "someone-else") is None  # uid-scoped
    finally:
        chatjob.openrouter.stream_completion = original_stream
        chatjob.analytics.record_usage_event = original_meter


def test_job_lifecycle():
    asyncio.run(_lifecycle())


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(dict(globals()).items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"ok - {name}")
            except Exception as error:
                failures += 1
                print(f"FAIL - {name}: {error!r}")
    sys.exit(1 if failures else 0)

"""Unit + lifecycle tests for the Xyro backend.

Run:  python -m pytest tests/ -q     (or: python tests/test_units.py)
No network or Firebase credentials needed: the job lifecycle runs
against in-memory fakes and a stubbed model stream.
"""
from __future__ import annotations

import asyncio
import copy
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


# --- Admin API (app/admin.py) -------------------------------------
# Self-contained stubs for the exact Firestore/Auth surface the
# admin module uses.

class _AdminSnap:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return copy.deepcopy(self._data) if self._data else None


class _AdminQuery:
    def __init__(self, docs, filters=None, order=None, limit_n=None):
        self._docs = docs
        self._filters = filters or []
        self._order = order
        self._limit = limit_n

    def where(self, field, _op, value):
        return _AdminQuery(
            self._docs,
            self._filters + [(field, value)],
            self._order,
            self._limit,
        )

    def order_by(self, field, direction=None):
        return _AdminQuery(self._docs, self._filters, (field, direction), self._limit)

    def limit(self, n):
        return _AdminQuery(self._docs, self._filters, self._order, n)

    def get(self):
        rows = [
            (doc_id, data)
            for doc_id, data in self._docs
            if all(data.get(field) == value for field, value in self._filters)
        ]
        if self._order:
            field, direction = self._order
            rows.sort(
                key=lambda row: row[1].get(field) or 0,
                reverse=(direction == "DESCENDING"),
            )
        if self._limit:
            rows = rows[: self._limit]
        return [_AdminSnap(doc_id, data) for doc_id, data in rows]


class _AdminDoc:
    def __init__(self, store, collection, doc_id):
        self._store = store
        self._collection = collection
        self._id = doc_id

    def get(self):
        return _AdminSnap(self._id, self._store.get((self._collection, self._id)))

    def set(self, data, merge=False):
        key = (self._collection, self._id)
        if merge and key in self._store:
            self._store[key] = {**self._store[key], **data}
        else:
            self._store[key] = dict(data)


class _AdminCollection(_AdminQuery):
    def __init__(self, store, name):
        self._store = store
        self._name = name
        docs = [
            (doc_id, data)
            for (collection, doc_id), data in store.items()
            if collection == name
        ]
        super().__init__(docs)

    def document(self, doc_id):
        return _AdminDoc(self._store, self._name, doc_id)

    def add(self, data):
        doc_id = f"auto{len(self._store)}"
        self._store[(self._name, doc_id)] = dict(data)
        return None, _AdminDoc(self._store, self._name, doc_id)


class _AdminDb:
    def __init__(self):
        self.store = {}

    def collection(self, name):
        return _AdminCollection(self.store, name)


class _FakeUserRecord:
    def __init__(self, uid, email, admin_flag=False):
        self.uid = uid
        self.email = email
        self.display_name = None
        self.email_verified = True
        self.disabled = False
        self._admin_flag = admin_flag

        class _Meta:
            creation_timestamp = 1700000000000
            last_sign_in_timestamp = 1700001000000

        self.user_metadata = _Meta()


class _FakeAuthModule:
    def __init__(self, records):
        self.records = records
        self.updated = []

    def get_user(self, uid):
        return self.records[uid]

    def list_users(self, max_results=200):
        records = self.records

        class _Page:
            page_token = None

            def iterate_all(self):
                return iter(list(records.values()))

        return _Page()

    def update_user(self, uid, disabled=None):
        self.updated.append((uid, disabled))
        self.records[uid].disabled = bool(disabled)


def test_admin_gate_and_actions():
    from app import admin

    db = _AdminDb()
    db.store[("users", "boss1")] = {"admin": True, "displayName": "Boss"}
    db.store[("users", "plain1")] = {"displayName": "Plain"}
    records = {
        "boss1": _FakeUserRecord("boss1", "boss@example.com"),
        "plain1": _FakeUserRecord("plain1", "plain@example.com"),
    }
    fake_auth = _FakeAuthModule(records)
    original_auth = admin.firebase_auth
    original_verify = admin.verify_id_token
    original_secret = admin.settings.admin_api_secret
    original_token = admin.settings.service_token
    admin.firebase_auth = lambda: fake_auth
    admin.verify_id_token = lambda token: {"tok-boss": "boss1", "tok-plain": "plain1"}.get(token)
    admin.settings.admin_api_secret = "test-admin-secret"
    admin.settings.service_token = "test-service-token"
    try:
        async def gate(token, secret, bearer, ip="10.0.0.1"):
            return await admin.authenticate_admin(token, secret, bearer, ip, db)

        # Wrong service token -> 401.
        try:
            asyncio.run(gate("nope", "test-admin-secret", "Bearer tok-boss"))
            raise AssertionError("bad service token accepted")
        except admin.AdminAuthError as error:
            assert error.status == 401
        # Wrong admin secret -> 401 (the main app's token alone is not enough).
        try:
            asyncio.run(gate("test-service-token", "nope", "Bearer tok-boss"))
            raise AssertionError("bad admin secret accepted")
        except admin.AdminAuthError as error:
            assert error.status == 401
        # Non-admin user -> 403.
        try:
            asyncio.run(gate("test-service-token", "test-admin-secret", "Bearer tok-plain"))
            raise AssertionError("non-admin accepted")
        except admin.AdminAuthError as error:
            assert error.status == 403
        # DB-flagged admin -> in.
        uid, email = asyncio.run(
            gate("test-service-token", "test-admin-secret", "Bearer tok-boss")
        )
        assert uid == "boss1" and email == "boss@example.com"

        # Promote writes the flag; audit is recorded.
        admin.patch_user(db, "boss1", "plain1", "promote")
        assert db.store[("users", "plain1")]["admin"] is True
        assert any(coll == "adminActions" for (coll, _id) in db.store)
        # Self-demote is refused.
        try:
            admin.patch_user(db, "boss1", "boss1", "demote")
            raise AssertionError("self-demote allowed")
        except admin.AdminAuthError as error:
            assert error.code == "SELF_ACTION"
        # Disable flows to the auth module.
        admin.patch_user(db, "boss1", "plain1", "disable")
        assert fake_auth.updated == [("plain1", True)]

        # Directory + overview shape against the stubs.
        directory = admin.get_users(db)
        assert directory["users"][0]["uid"] == "boss1"  # admins first
        assert any(u["admin"] for u in directory["users"])
        overview = admin.get_overview(db)
        assert len(overview["minutes"]) == 60
        assert overview["backend"]["integrationsOk"] in (True, False)
        assert "totals" in overview and "recentEvents" in overview
    finally:
        admin.firebase_auth = original_auth
        admin.verify_id_token = original_verify
        admin.settings.admin_api_secret = original_secret
        admin.settings.service_token = original_token


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

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

    def where(self, field, op, value):
        return _AdminQuery(
            self._docs,
            self._filters + [(field, op, value)],
            self._order,
            self._limit,
        )

    def order_by(self, field, direction=None):
        return _AdminQuery(self._docs, self._filters, (field, direction), self._limit)

    def limit(self, n):
        return _AdminQuery(self._docs, self._filters, self._order, n)

    def get(self):
        def matches(data):
            for field, op, value in self._filters:
                current = data.get(field)
                if op == ">=":
                    if not (isinstance(current, str) and current >= value):
                        return False
                elif current != value:
                    return False
            return True

        rows = [(doc_id, data) for doc_id, data in self._docs if matches(data)]
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

    def delete(self):
        self._store.pop((self._collection, self._id), None)

    def collection(self, name):
        return _AdminCollection(
            self._store, f"{self._collection}/{self._id}/{name}"
        )


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
        self.photo_url = None
        self.email_verified = True
        self.disabled = False
        self._admin_flag = admin_flag

        class _Meta:
            creation_timestamp = 1700000000000
            last_sign_in_timestamp = 1700001000000

        self.user_metadata = _Meta()
        self.provider_data = []


class _FakeAuthModule:
    def __init__(self, records):
        self.records = records
        self.updated = []

    def get_user(self, uid):
        return self.records[uid]

    def list_users(self, max_results=200):
        records = self.records

        class _Page:
            # Mirrors the real firebase_admin ListUsersPage,
            # whose members are: users, next_page_token,
            # has_next_page, get_next_page, iterate_all.
            next_page_token = None
            has_next_page = False

            def iterate_all(self):
                return iter(list(records.values()))

        return _Page()

    def update_user(self, uid, disabled=None):
        self.updated.append((uid, disabled))
        self.records[uid].disabled = bool(disabled)

    def delete_user(self, uid):
        self.updated.append((uid, "deleted"))
        self.records.pop(uid, None)

    def generate_password_reset_link(self, email):
        return f"https://example.test/reset?email={email}"

    def revoke_refresh_tokens(self, uid):
        self.updated.append((uid, "revoked"))


def test_admin_gate_and_actions():
    from app import admin

    db = _AdminDb()
    # Authority is the dedicated admins registry (doc id = uid),
    # NOT a flag on the profile: plain1 HAS admin: true on the
    # profile and must still be refused.
    db.store[("admins", "boss1")] = {"role": "owner", "grantedBy": "boss1"}
    db.store[("admins", "emp1")] = {"role": "admin", "grantedBy": "boss1"}
    db.store[("users", "boss1")] = {"displayName": "Boss"}
    db.store[("users", "plain1")] = {"displayName": "Plain", "admin": True}
    records = {
        "boss1": _FakeUserRecord("boss1", "boss@example.com"),
        "emp1": _FakeUserRecord("emp1", "emp@example.com"),
        "plain1": _FakeUserRecord("plain1", "plain@example.com"),
    }
    fake_auth = _FakeAuthModule(records)
    original_auth = admin.firebase_auth
    original_verify = admin.verify_id_token_detailed
    original_secret = admin.settings.admin_api_secret
    original_token = admin.settings.service_token
    original_owner_secret = os.environ.get("OWNER_SECRET")
    os.environ["OWNER_SECRET"] = "test-owner-secret"
    admin.firebase_auth = lambda: fake_auth
    admin.verify_id_token_detailed = lambda token: (
        {
            "tok-boss": "boss1",
            "tok-emp": "emp1",
            "tok-plain": "plain1",
        }.get(token),
        None,
    )
    admin.settings.admin_api_secret = "test-admin-secret"
    admin.settings.service_token = "test-service-token"
    try:
        async def gate(token, secret, bearer, ip="10.0.0.1"):
            return await admin.authenticate_admin(
                token, secret, bearer, ip, lambda: db
            )

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
        # Profile flag without a registry entry -> 403.
        try:
            asyncio.run(gate("test-service-token", "test-admin-secret", "Bearer tok-plain"))
            raise AssertionError("profile-flag user accepted")
        except admin.AdminAuthError as error:
            assert error.status == 403
        # Registry roles resolve.
        uid, email, role = asyncio.run(
            gate("test-service-token", "test-admin-secret", "Bearer tok-boss")
        )
        assert (uid, role) == ("boss1", "owner")
        uid, email, role = asyncio.run(
            gate("test-service-token", "test-admin-secret", "Bearer tok-emp", ip="10.0.0.2")
        )
        assert (uid, role) == ("emp1", "admin")

        # A plain admin cannot grant admin access (owner-only).
        try:
            admin.patch_user(db, "emp1", "admin", "emp@example.com", "plain1", "promote")
            raise AssertionError("admin granted access")
        except admin.AdminAuthError as error:
            assert error.code == "OWNER_ONLY"
        # The owner grants: a registry entry appears, role admin.
        admin.patch_user(db, "boss1", "owner", "boss@example.com", "plain1", "promote", owner_secret_value="test-owner-secret")
        assert db.store[("admins", "plain1")]["role"] == "admin"
        assert db.store[("admins", "plain1")]["grantedBy"] == "boss1"
        assert any(coll == "adminActions" for (coll, _id) in db.store)
        # The owner revokes at any time: the entry is deleted.
        admin.patch_user(db, "boss1", "owner", "boss@example.com", "plain1", "demote", owner_secret_value="test-owner-secret")
        assert ("admins", "plain1") not in db.store
        # Self-demote is refused; the owner entry is protected.
        try:
            admin.patch_user(db, "boss1", "owner", "boss@example.com", "boss1", "demote")
            raise AssertionError("self-demote allowed")
        except admin.AdminAuthError as error:
            assert error.code == "SELF_ACTION"
        # A plain admin may disable a normal account but not the owner.
        admin.patch_user(db, "emp1", "admin", "emp@example.com", "plain1", "disable")
        assert fake_auth.updated == [("plain1", True)]
        try:
            admin.patch_user(db, "emp1", "admin", "emp@example.com", "boss1", "disable")
            raise AssertionError("admin disabled the owner")
        except admin.AdminAuthError as error:
            assert error.code == "OWNER_ONLY"

        # Directory carries roles + viewer; owner sorts first.
        directory = admin.get_users(db, "boss1", "owner")
        assert directory["viewer"] == {
            "uid": "boss1",
            "role": "owner",
            "registered": True,
            "ownerSecretConfigured": True,
        }
        assert directory["users"][0]["uid"] == "boss1"
        assert directory["users"][0]["role"] == "owner"
        emp_row = next(u for u in directory["users"] if u["uid"] == "emp1")
        assert emp_row["role"] == "admin" and emp_row["admin"] is True
        overview = admin.get_overview(db)
        assert len(overview["minutes"]) == 60
        assert len(overview["week"]) == 7
        assert "yesterday" in overview
        assert overview["backend"]["integrationsOk"] in (True, False)
        assert "totals" in overview and "recentEvents" in overview

        # Account deletion: owner-only, with full effects.
        try:
            admin.patch_user(db, "emp1", "admin", "emp@example.com", "plain1", "delete")
            raise AssertionError("admin deleted an account")
        except admin.AdminAuthError as error:
            assert error.code == "OWNER_ONLY"
        admin.patch_user(db, "boss1", "owner", "boss@example.com", "plain1", "delete", owner_secret_value="test-owner-secret")
        assert ("plain1", "deleted") in fake_auth.updated
        assert ("users", "plain1") not in db.store

        # The audit trail reads back what the actions wrote.
        audit = admin.get_audit(db)
        assert any(entry["action"] == "delete" for entry in audit["entries"])
        assert all("actorEmail" in entry for entry in audit["entries"])
    finally:
        admin.firebase_auth = original_auth
        admin.verify_id_token_detailed = original_verify
        admin.settings.admin_api_secret = original_secret
        admin.settings.service_token = original_token
        if original_owner_secret is None:
            os.environ.pop("OWNER_SECRET", None)
        else:
            os.environ["OWNER_SECRET"] = original_owner_secret


def test_key_normalization_repairs_pastes():
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives.serialization import (
        Encoding,
        NoEncryption,
        PrivateFormat,
    )

    from app.firebase import _key_candidates, _key_parses

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode()

    def repaired(value: str) -> bool:
        return any(_key_parses(candidate) for candidate in _key_candidates(value))

    assert repaired(pem)  # pristine
    assert repaired(pem.replace("\n", "\\n"))  # literal \n escapes
    assert repaired(f'"{pem}"')  # wrapped in quotes
    assert repaired(pem.replace("\n", "\r\n"))  # Windows endings
    body = "".join(
        line for line in pem.splitlines() if "PRIVATE KEY" not in line
    )
    assert repaired(body)  # PEM frame lost entirely
    assert not repaired("not-a-key-at-all")  # garbage stays garbage


def test_public_id_token_verification():
    import datetime as _dt

    import jwt as pyjwt
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives.serialization import (
        Encoding,
        NoEncryption,
        PrivateFormat,
    )
    from cryptography.x509.oid import NameOID

    from app import auth as auth_mod

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=1))
        .not_valid_after(_dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(days=30))
        .sign(key, hashes.SHA256())
    )
    cert_pem = cert.public_bytes(Encoding.PEM).decode()
    key_pem = key.private_bytes(
        Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()
    ).decode()

    original_certs = auth_mod._google_certs
    original_json = auth_mod.settings.firebase_service_account_json
    original_pid = auth_mod.settings.firebase_project_id
    auth_mod._google_certs = lambda: {"kid1": cert_pem}
    auth_mod.settings.firebase_service_account_json = ""
    auth_mod.settings.firebase_project_id = "demo-project"
    try:
        now = _dt.datetime.now(_dt.timezone.utc)
        claims = {
            "sub": "user-123",
            "email": "owner@example.com",
            "aud": "demo-project",
            "iss": "https://securetoken.google.com/demo-project",
            "iat": now,
            "exp": now + _dt.timedelta(hours=1),
        }
        token = pyjwt.encode(claims, key_pem, algorithm="RS256", headers={"kid": "kid1"})
        uid, email, failure = auth_mod.verify_id_token_public(token)
        assert (uid, email, failure) == ("user-123", "owner@example.com", None)

        bad = dict(claims, aud="someone-elses-project")
        bad_token = pyjwt.encode(bad, key_pem, algorithm="RS256", headers={"kid": "kid1"})
        uid, email, failure = auth_mod.verify_id_token_public(bad_token)
        assert uid is None and failure is not None
    finally:
        auth_mod._google_certs = original_certs
        auth_mod.settings.firebase_service_account_json = original_json
        auth_mod.settings.firebase_project_id = original_pid


def test_admin_autoprovision_owner():
    from app import admin

    db = _AdminDb()
    records = {"owner1": _FakeUserRecord("owner1", "mostakimbdyt@gmail.com")}
    fake_auth = _FakeAuthModule(records)
    originals = (
        admin.firebase_auth,
        admin.verify_id_token_detailed,
        admin.verify_id_token_public,
        admin.settings.admin_api_secret,
        admin.settings.service_token,
    )
    admin.firebase_auth = lambda: fake_auth
    # SDK path broken (damaged key); public-key path verifies.
    admin.verify_id_token_detailed = lambda token: (None, "ValueError")
    admin.verify_id_token_public = lambda token: (
        "owner1",
        "mostakimbdyt@gmail.com",
        None,
    )
    admin.settings.admin_api_secret = "s3cret"
    admin.settings.service_token = "tok3n"
    try:
        uid, email, role = asyncio.run(
            admin.authenticate_admin(
                "tok3n", "s3cret", "Bearer anything", "10.9.9.9", lambda: db
            )
        )
        assert (uid, role) == ("owner1", "owner")
        # The registry entry was created automatically — nobody
        # had to create a document by hand.
        entry = db.store[("admins", "owner1")]
        assert entry["role"] == "owner"
        assert entry["grantedBy"] == "auto-bootstrap"
    finally:
        (
            admin.firebase_auth,
            admin.verify_id_token_detailed,
            admin.verify_id_token_public,
            admin.settings.admin_api_secret,
            admin.settings.service_token,
        ) = originals


def test_admin_detail_logs_trash_and_ranges():
    from app import admin

    db = _AdminDb()
    records = {
        "boss1": _FakeUserRecord("boss1", "boss@example.com"),
        "emp1": _FakeUserRecord("emp1", "emp@example.com"),
        "plain1": _FakeUserRecord("plain1", "plain@example.com"),
    }
    fake_auth = _FakeAuthModule(records)
    original = admin.firebase_auth
    admin.firebase_auth = lambda: fake_auth
    try:
        db.store[("admins", "boss1")] = {"role": "owner"}
        db.store[("users", "plain1")] = {"displayName": "Plain User"}
        db.store[("users/plain1/chats", "c1")] = {
            "title": "First chat",
            "updatedAt": 5000,
        }
        db.store[("users/plain1/apiKeys", "k1")] = {
            "name": "prod",
            "revoked": False,
            "createdAt": 4000,
        }
        db.store[("analytics_user_days", "2026-11-16__plain1")] = {
            "day": "2026-11-16",
            "uid": "plain1",
            "requests": 3,
            "totalTokens": 900,
            "costUsd": 0.0,
        }
        db.store[("analytics_days", "2026-11-16")] = {
            "day": "2026-11-16",
            "requests": 10,
            "totalTokens": 5000,
        }
        db.store[("analytics_minutes", "m1")] = {
            "minute": "2999-01-01T00:00",
            "requests": 1,
            "totalTokens": 10,
        }
        db.store[("usageEvents", "e1")] = {
            "ts": 3000,
            "uid": "plain1",
            "surface": "chat",
            "model": "openrouter/free",
            "totalTokens": 42,
            "status": "ok",
        }
        db.store[("chatErrors", "x1")] = {
            "ts": 2000,
            "uid": "plain1",
            "status": 429,
            "model": "openrouter/free",
            "error": "quota",
        }

        # Detail: identity + subcollections + lifetime.
        detail = admin.get_user_detail(db, "plain1")
        assert detail["email"] == "plain@example.com"
        assert detail["chats"]["count"] == 1
        assert detail["apiKeys"][0]["name"] == "prod"
        assert detail["lifetime"]["totalTokens"] == 900

        # Users list carries lifetime usage.
        payload = admin.get_users(db, "boss1", "owner")
        plain_row = next(r for r in payload["users"] if r["uid"] == "plain1")
        assert plain_row["lifetimeTokens"] == 900

        # Overview carries lifetime + ranges + live keys.
        overview = admin.get_overview(db)
        assert overview["lifetime"]["totalTokens"] >= 5000
        assert "24h" in overview["ranges"] and "48h" in overview["ranges"]
        assert overview["live"] == {"streams": 0, "generating": 0}

        # Logs merge newest-first with error codes.
        logs = admin.get_logs(db)
        kinds = [row["kind"] for row in logs["entries"]]
        assert kinds[0] == "request" and "error" in kinds
        error_row = next(r for r in logs["entries"] if r["kind"] == "error")
        assert error_row["code"] == 429

        # Storage reports unconfigured honestly.
        assert admin.get_storage() == {"configured": False}

        # Full-control actions.
        result = admin.patch_user(
            db, "boss1", "owner", "boss@example.com", "plain1", "reset-link"
        )
        assert result["link"].startswith("https://example.test/reset")
        admin.patch_user(
            db, "boss1", "owner", "boss@example.com", "plain1", "sign-out-all"
        )
        assert ("plain1", "revoked") in fake_auth.updated
        # An employee may not mint a reset link for the owner.
        try:
            admin.patch_user(
                db, "emp1", "admin", "emp@example.com", "boss1", "reset-link"
            )
            raise AssertionError("employee reset-link on owner must fail")
        except admin.AdminAuthError as error:
            assert error.status == 403

        # Delete snapshots into the trash first. (Delete is an
        # owner-secret-gated action.)
        os.environ["OWNER_SECRET"] = "test-owner-secret"
        admin.patch_user(
            db, "boss1", "owner", "boss@example.com", "plain1", "delete",
            owner_secret_value="test-owner-secret",
        )
        os.environ.pop("OWNER_SECRET", None)
        snapshot = db.store[("deletedUsers", "plain1")]
        assert snapshot["email"] == "plain@example.com"
        assert snapshot["stats"]["chats"] == 1
        assert snapshot["stats"]["lifetimeTokens"] == 900
        trash = admin.get_trash(db)
        assert trash["totals"]["accounts"] == 1
        assert trash["totals"]["chats"] == 1
        assert trash["entries"][0]["lifetimeTokens"] == 900
    finally:
        admin.firebase_auth = original


def test_memory_extract_and_live_text():
    from app import memory as mem

    clean, facts = mem.extract_memories(
        "Answer here.\n[[memory: The user lives in Dhaka]]\n[[memory: User is building a startup]]"
    )
    assert clean == "Answer here."
    assert facts == ["The user lives in Dhaka", "User is building a startup"]
    assert mem.live_visible_text("Hello [[memory: The user") == "Hello"
    assert mem.live_visible_text("No markers") == "No markers"
    block = mem.memory_system_block(["User lives in Dhaka"])
    assert "- User lives in Dhaka" in block and "[[memory:" in block
    assert mem.normalize_memory_key("User likes Tea!") == mem.normalize_memory_key("user likes tea")


def test_cross_provider_targets_and_order():
    import os

    from app import models as model_lib
    from app import openrouter

    saved = dict(os.environ)
    try:
        for key in ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "HF_TOKEN", "HUGGINGFACE_API_KEY"]:
            os.environ.pop(key, None)
        assert openrouter.cross_provider_targets() == []
        os.environ["GROQ_API_KEY"] = "gsk_test"
        os.environ["GEMINI_API_KEY"] = "gem_test"
        targets = openrouter.build_targets(["openrouter/free"])
        assert targets[0]["provider"] == "openrouter"
        assert targets[1]["provider"] == "gemini"
        assert targets[1]["label"] == "gemini/gemini-2.5-flash"
        assert any(t["provider"] == "groq" and t["model"] == "openai/gpt-oss-120b" for t in targets)
    finally:
        os.environ.clear()
        os.environ.update(saved)

    order = model_lib.model_attempt_order("openrouter/free")
    assert order[0] == "openrouter/free"
    assert "nvidia/nemotron-3-ultra-550b-a55b:free" in order
    assert not any("llama-3.3-70b" in item for item in order)
    web = model_lib.web_model_attempt_order("openrouter/free")
    assert web[0] == "nvidia/nemotron-3-ultra-550b-a55b:free"
    assert web[-1] == "openrouter/free"


def test_provider_presence_reports_keys():
    saved = dict(os.environ)
    try:
        for key in ("GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "GROQ_API_KEY",
                    "REQUESTY_API_KEY", "SAMBANOVA_API_KEY",
                    "NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"):
            os.environ.pop(key, None)
        presence = chatjob.openrouter.provider_presence()
        assert presence == {
            "gemini": False, "groq": False, "requesty": False,
            "sambanova": False, "nvidia": False, "cloudflare": False,
        }, presence
        os.environ["GROQ_API_KEY"] = "test-key"
        assert chatjob.openrouter.provider_presence()["groq"] is True
    finally:
        os.environ.clear()
        os.environ.update(saved)


def test_vision_targets_only_include_vision_models():
    saved = dict(os.environ)
    try:
        os.environ["GEMINI_API_KEY"] = "g"
        os.environ["GROQ_API_KEY"] = "q"
        os.environ["REQUESTY_API_KEY"] = "r"
        targets = chatjob.openrouter.build_targets(["openrouter/free"], vision_only=True)
        providers = [t["provider"] for t in targets]
        assert "groq" not in providers
        assert providers.count("gemini") == 2
        requesty = [t for t in targets if t["provider"] == "requesty"]
        assert len(requesty) == 1 and requesty[0]["model"] == "google/gemma-4-31b-it"
    finally:
        os.environ.clear()
        os.environ.update(saved)


def test_refusal_detection_and_providers_first():
    assert chatjob.openrouter.looks_like_refusal("I can't browse the internet, sorry.")
    assert chatjob.openrouter.looks_like_refusal("As an AI language model, I don't have real-time access.")
    assert not chatjob.openrouter.looks_like_refusal("Here is the answer you asked for.")
    assert not chatjob.openrouter.looks_like_refusal("I can't recommend one brand, but here are options.")
    saved = dict(os.environ)
    try:
        os.environ["GROQ_API_KEY"] = "g"
        targets = chatjob.openrouter.build_targets(["openrouter/free"], providers_first=True)
        assert targets[0]["provider"] == "groq"
        normal = chatjob.openrouter.build_targets(["openrouter/free"])
        assert normal[0]["provider"] == "openrouter"
    finally:
        os.environ.clear()
        os.environ.update(saved)


def test_cloudflare_targets_and_modes():
    saved = dict(os.environ)
    try:
        os.environ["CLOUDFLARE_API_TOKEN"] = "tok"
        # Token without the account id: provider skipped entirely.
        bare = [t for t in chatjob.openrouter.cross_provider_targets() if t["provider"] == "cloudflare"]
        assert bare == []
        os.environ["CLOUDFLARE_ACCOUNT_ID"] = "acc123"
        cf = [t for t in chatjob.openrouter.cross_provider_targets() if t["provider"] == "cloudflare"]
        assert len(cf) == 3
        assert all("/accounts/acc123/" in t["url"] for t in cf)
        assert chatjob.openrouter.provider_presence()["cloudflare"] is True
        light = chatjob.openrouter.build_targets(["openrouter/free"], preferred_provider="cloudflare")
        assert light[0]["provider"] == "cloudflare"
    finally:
        os.environ.clear()
        os.environ.update(saved)
    assert models.is_model_mode("fast")
    assert models.MODEL_MODE_PROVIDERS["fast"] == "groq"
    assert models.MODEL_MODE_PROVIDERS["lightweight"] == "cloudflare"
    assert not models.is_model_mode("openrouter/free")


def test_owner_secret_gate_and_directory_search():
    from app import admin

    db = _AdminDb()
    db.store[("users", "target1")] = {"displayName": "Target One"}
    db.store[("users", "other1")] = {"displayName": "Someone Else"}
    records = {
        "target1": _FakeUserRecord("target1", "target@example.com"),
        "other1": _FakeUserRecord("other1", "other@example.com"),
    }
    fake_auth = _FakeAuthModule(records)
    original_auth = admin.firebase_auth
    admin.firebase_auth = lambda: fake_auth
    saved = dict(os.environ)
    try:
        # No OWNER_SECRET configured: grants fail CLOSED.
        os.environ.pop("OWNER_SECRET", None)
        try:
            admin.patch_user(db, "owner-uid", "owner", "o@x.com", "target1", "promote", owner_secret_value="anything")
            raise AssertionError("promote should fail closed without OWNER_SECRET")
        except admin.AdminAuthError as error:
            assert error.code == "OWNER_SECRET_NOT_CONFIGURED", error.code
        # Configured but wrong secret: 403, nothing written.
        os.environ["OWNER_SECRET"] = "correct-horse"
        try:
            admin.patch_user(db, "owner-uid", "owner", "o@x.com", "target1", "promote", owner_secret_value="wrong")
            raise AssertionError("promote should reject a wrong owner secret")
        except admin.AdminAuthError as error:
            assert error.code == "OWNER_SECRET_INVALID", error.code
        assert ("admins", "target1") not in db.store
        # Correct secret: the grant lands in the registry.
        result = admin.patch_user(db, "owner-uid", "owner", "o@x.com", "target1", "promote", owner_secret_value="correct-horse")
        assert result["success"] is True
        assert db.store[("admins", "target1")]["role"] == "admin"
        # A non-owner is refused even WITH the secret.
        try:
            admin.patch_user(db, "someone", "admin", "a@x.com", "target1", "demote", owner_secret_value="correct-horse")
            raise AssertionError("non-owner demote should be OWNER_ONLY")
        except admin.AdminAuthError as error:
            assert error.code == "OWNER_ONLY", error.code
        # Routine actions are NOT secret-gated.
        result = admin.patch_user(db, "owner-uid", "owner", "o@x.com", "target1", "sign-out-all")
        assert result["success"] is True

        # Directory-wide search matches email, profile name and uid.
        by_email = admin.get_users(db, "owner-uid", "owner", query="target@exam")
        assert [row["uid"] for row in by_email["users"]] == ["target1"]
        assert by_email["viewer"]["ownerSecretConfigured"] is True
        by_name = admin.get_users(db, "owner-uid", "owner", query="someone")
        assert [row["uid"] for row in by_name["users"]] == ["other1"]
        by_uid = admin.get_users(db, "owner-uid", "owner", query="target1")
        assert [row["uid"] for row in by_uid["users"]] == ["target1"]
        no_match = admin.get_users(db, "owner-uid", "owner", query="zzz-no-match")
        assert no_match["users"] == []
    finally:
        admin.firebase_auth = original_auth
        os.environ.clear()
        os.environ.update(saved)


def test_security_bot_protection():
    from app import security

    saved = dict(os.environ)
    try:
        security._STATE.clear()
        # Scanner paths block immediately — and stay blocked.
        assert security.decision("1.1.1.1", "/.env") == "block"
        assert security.decision("1.1.1.1", "/health") == "block"
        security.clear_flags("1.1.1.1")
        assert security.decision("1.1.1.1", "/health") == "allow"
        # Auth failures flag first, then block at the higher count.
        for _ in range(security.FLAG_AUTH_FAILURES):
            security.record_auth_failure("2.2.2.2")
        assert security.decision("2.2.2.2", "/v1/admin/overview") == "challenge"
        for _ in range(security.BLOCK_AUTH_FAILURES):
            security.record_auth_failure("2.2.2.2")
        assert security.decision("2.2.2.2", "/v1/admin/overview") == "block"
        # Human pass: roundtrip works, wrong IP / UA / tamper fails.
        token = security.mint_pass("3.3.3.3", "UA-one")
        assert security.check_pass(token, "3.3.3.3", "UA-one")
        assert not security.check_pass(token, "3.3.3.3", "UA-two")
        assert not security.check_pass(token, "4.4.4.4", "UA-one")
        assert not security.check_pass(token + "x", "3.3.3.3", "UA-one")
        assert not security.check_pass(None, "3.3.3.3", "UA-one")
        # A 404 flood flags the IP for a challenge.
        for _ in range(security.FLAG_NOT_FOUND):
            security.record_not_found("5.5.5.5")
        assert security.decision("5.5.5.5", "/v1/models") == "challenge"
        # Turnstile verify fails closed when unconfigured.
        os.environ.pop("TURNSTILE_SECRET_KEY", None)
        ok, reason = asyncio.run(security.verify_turnstile("tok", "1.2.3.4"))
        assert (ok, reason) == (False, "not_configured")
        security._STATE.clear()
    finally:
        os.environ.clear()
        os.environ.update(saved)


def test_security_middleware_smoke():
    from fastapi.testclient import TestClient

    from app import main as main_mod
    from app import security

    security._STATE.clear()
    client = TestClient(main_mod.app, raise_server_exceptions=False)
    # Health is public and carries the hardening headers.
    health = client.get("/health")
    assert health.status_code == 200
    assert health.headers.get("x-content-type-options") == "nosniff"
    assert health.headers.get("x-frame-options") == "DENY"
    # A scanner probe is blocked outright, not 404'd.
    probe = client.get("/.env")
    assert probe.status_code == 403
    assert probe.json()["error"]["code"] == "IP_BLOCKED"
    security._STATE.clear()
    # Bot verify demands the service token.
    verify = client.post("/v1/bot/verify", json={"token": "x", "ip": "1.2.3.4"})
    assert verify.status_code == 401
    # Oversized bodies are refused before any handler runs.
    big = client.post("/v1/chat/jobs", content=b"x" * (2 * 1024 * 1024 + 10))
    assert big.status_code == 413
    security._STATE.clear()


def test_delegation_assertion():
    import base64 as b64_mod
    import hashlib as hl
    import hmac as hm
    import json as json_mod
    import time as time_mod

    from app import auth
    from app.config import settings

    def mint(uid, token, exp):
        payload = b64_mod.urlsafe_b64encode(
            json_mod.dumps({"uid": uid, "exp": exp}, separators=(",", ":")).encode()
        ).decode().rstrip("=")
        sig = hm.new(token.encode(), payload.encode(), hl.sha256).hexdigest()
        return payload + "." + sig

    saved_token = settings.service_token
    try:
        settings.service_token = "test-service-token-0123456789"
        now = int(time_mod.time())
        good = mint("user-123", settings.service_token, now + 300)
        # The shared interop vector (fixed clock) must verify when
        # time is frozen at its mint moment — the TS suite pins
        # the exact string the app produces.
        vector = (
            "eyJ1aWQiOiJ1c2VyLTEyMyIsImV4cCI6MTcwMDAwMDM2MH0"
            ".985baa291a91627338877648e88fe8e791d7de37489272b40607cd58a70e6d54"
        )
        real_time = time_mod.time
        auth.time.time = lambda: 1_700_000_000  # noqa: SLF001 - test patch
        try:
            assert auth.verify_delegation_assertion(vector) == {"uid": "user-123"}
        finally:
            auth.time.time = real_time  # noqa: SLF001 - test patch
        assert auth.verify_delegation_assertion(good) == {"uid": "user-123"}
        # Tampered signature, wrong key, expired, malformed.
        assert auth.verify_delegation_assertion(good[:-1] + "0") is None
        assert auth.verify_delegation_assertion(
            mint("user-123", "other-token", now + 300)
        ) is None
        assert auth.verify_delegation_assertion(
            mint("user-123", settings.service_token, now - 5)
        ) is None
        assert auth.verify_delegation_assertion("not-an-assertion") is None
        assert auth.verify_delegation_assertion(None) is None

        # Full authenticate(): assertion replaces the cookie leg,
        # the ID-token leg still runs and must match the uid.
        real_verify = auth.verify_id_token
        auth.verify_id_token = lambda token: "user-123" if token == "good-token" else None
        try:
            session = asyncio.run(
                auth.authenticate(
                    settings.service_token,
                    None,
                    "Bearer good-token",
                    delegation=good,
                )
            )
            assert session is not None and session["uid"] == "user-123"
            # ID token for a different user -> rejected.
            auth.verify_id_token = lambda token: "someone-else"
            assert asyncio.run(
                auth.authenticate(
                    settings.service_token,
                    None,
                    "Bearer good-token",
                    delegation=good,
                )
            ) is None
            # Bad assertion -> rejected even with a good ID token.
            auth.verify_id_token = lambda token: "user-123"
            assert asyncio.run(
                auth.authenticate(
                    settings.service_token,
                    None,
                    "Bearer good-token",
                    delegation=good[:-1] + "0",
                )
            ) is None
        finally:
            auth.verify_id_token = real_verify
    finally:
        settings.service_token = saved_token


def test_admin_privileged_targets_and_secret_verify():
    from app import admin

    db = _AdminDb()
    db.store[("admins", "boss")] = {"role": "owner"}
    db.store[("admins", "helper")] = {"role": "admin"}
    records = {
        "boss": _FakeUserRecord("boss", "boss@example.com"),
        "helper": _FakeUserRecord("helper", "helper@example.com"),
        "plain": _FakeUserRecord("plain", "plain@example.com"),
    }
    records["plain"].photo_url = "https://img.example/plain.png"
    fake_auth = _FakeAuthModule(records)
    original_auth = admin.firebase_auth
    admin.firebase_auth = lambda: fake_auth
    saved = dict(os.environ)
    try:
        # Directory rows carry the profile picture.
        listing = admin.get_users(db, "boss", "owner")
        plain_row = next(r for r in listing["users"] if r["uid"] == "plain")
        assert plain_row["photoUrl"] == "https://img.example/plain.png"
        boss_row = next(r for r in listing["users"] if r["uid"] == "boss")
        assert boss_row["photoUrl"] is None

        def expect_code(code, fn):
            try:
                fn()
            except admin.AdminAuthError as error:
                assert error.code == code, error.code
                return
            raise AssertionError(f"expected {code}")

        # An admin can SEE a fellow admin but cannot disable them,
        # reset their password link, or sign them out — owner only.
        expect_code("OWNER_ONLY", lambda: admin.patch_user(
            db, "helper", "admin", "helper@example.com", "boss", "disable"))
        expect_code("OWNER_ONLY", lambda: admin.patch_user(
            db, "helper2", "admin", "h2@example.com", "helper", "disable"))
        expect_code("OWNER_ONLY", lambda: admin.patch_user(
            db, "helper2", "admin", "h2@example.com", "helper", "reset-link"))
        expect_code("OWNER_ONLY", lambda: admin.patch_user(
            db, "helper2", "admin", "h2@example.com", "helper", "sign-out-all"))
        # The same admin CAN still disable a normal user.
        result = admin.patch_user(db, "helper", "admin", "helper@example.com", "plain", "disable")
        assert result["success"] is True
        # And the owner can disable an admin.
        result = admin.patch_user(db, "boss", "owner", "boss@example.com", "helper", "disable")
        assert result["success"] is True

        # verify_owner_secret: exact failure taxonomy.
        os.environ.pop("OWNER_SECRET", None)
        expect_code("OWNER_SECRET_NOT_CONFIGURED", lambda: admin.verify_owner_secret("owner", "x"))
        os.environ["OWNER_SECRET"] = "correct-horse"
        expect_code("OWNER_SECRET_INVALID", lambda: admin.verify_owner_secret("owner", "nope"))
        expect_code("OWNER_ONLY", lambda: admin.verify_owner_secret("admin", "correct-horse"))
        assert admin.verify_owner_secret("owner", "correct-horse")["success"] is True
        # Surrounding whitespace from a mobile paste is forgiven.
        assert admin.verify_owner_secret("owner", "  correct-horse  ")["success"] is True
    finally:
        admin.firebase_auth = original_auth
        os.environ.clear()
        os.environ.update(saved)


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



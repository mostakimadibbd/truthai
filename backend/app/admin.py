"""Admin API for the separate Xyro admin panel.

The panel is a standalone app (its own deployment, linked from
nowhere in the product). It talks to these endpoints through its
own server, which attaches three credentials to every call:

  1. X-Service-Token — the shared backend service token.
  2. X-Admin-Secret — a second secret that exists only on this
     service and the panel, so the main app's credentials alone
     can never open an admin endpoint.
  3. Authorization: Bearer <Firebase ID token> of the signed-in
     administrator, verified here, whose uid must appear in the
     database's dedicated admins registry (see below).

Knowing this service's address alone therefore yields nothing:
every admin route fails closed without all three. Failed
attempts are throttled per client IP.

Admin authority lives in a dedicated registry collection,
`admins/{uid}`, whose document id IS the admin's uid and whose
`role` field is "owner" or "admin":

  - The OWNER is the single account whose registry entry says
    role "owner" (the project owner's email is also accepted as
    owner until the entry exists, so the panel can be claimed —
    claiming writes the entry). Only the owner can grant or
    revoke admin access, from the panel, at any time; revocation
    deletes the entry and takes effect on the next request.
  - ADMINs (e.g. the owner's employees) can monitor everything
    and enable/disable accounts, but cannot grant or revoke
    admin access — the backend refuses, not just the UI.

The registry is writable only by this service (Firestore rules
deny all client access to it), so nobody can self-promote.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import re
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx

from .auth import (
    check_service_token,
    decode_unverified_claims,
    verify_id_token_detailed,
    verify_id_token_public,
)
from .config import owner_secret, settings
from .firebase import firebase_app

BOOTSTRAP_ADMIN_EMAILS = ["mostakimbdyt@gmail.com"]

TOTAL_FIELDS = (
    "requests", "chatRequests", "apiRequests", "imageRequests",
    "promptTokens", "completionTokens", "totalTokens", "costUsd",
)

# Per-IP failed-auth throttle. The counter lives in the shared
# Upstash Redis store (the same one that holds session
# revocations) whenever it is configured, so the limit holds
# across every server instance; the in-memory map below is only
# a fallback for deployments without Upstash configured, where
# the limit is necessarily per-instance.
_failures: dict[str, list[float]] = {}
_FAILURE_LIMIT = 30
_FAILURE_WINDOW = 60.0


def _throttle_key(ip: str) -> str:
    digest = hashlib.sha256(ip.encode()).hexdigest()[:32]
    return f"adminauthfail:{digest}"


def _upstash_command(*parts: str) -> object | None:
    """Run one Redis command through the Upstash REST API.
    Returns the command result, or None when Upstash is not
    configured or unreachable (callers fall back to memory)."""
    if not (settings.upstash_rest_url and settings.upstash_rest_token):
        return None
    try:
        path = "/".join(quote(str(part), safe="") for part in parts)
        with httpx.Client(timeout=2.0) as client:
            response = client.post(
                f"{settings.upstash_rest_url}/{path}",
                headers={"Authorization": f"Bearer {settings.upstash_rest_token}"},
            )
            response.raise_for_status()
            return response.json().get("result")
    except Exception:
        return None


def _ms(value) -> int | None:
    """Best-effort epoch-ms from a stored timestamp value
    (int ms, or a Firestore datetime-like with .timestamp())."""
    if isinstance(value, (int, float)):
        return int(value)
    timestamp = getattr(value, "timestamp", None)
    if callable(timestamp):
        try:
            return int(timestamp() * 1000)
        except Exception:
            return None
    return None


class AdminAuthError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def firebase_auth():
    """Indirection so tests can substitute a fake auth module."""
    from firebase_admin import auth as fb_auth

    firebase_app()
    return fb_auth


def _throttled(ip: str) -> bool:
    shared = _upstash_command("get", _throttle_key(ip))
    if shared is not None:
        try:
            return int(shared) >= _FAILURE_LIMIT
        except (TypeError, ValueError):
            pass
    now = time.time()
    recent = [t for t in _failures.get(ip, []) if now - t < _FAILURE_WINDOW]
    _failures[ip] = recent
    return len(recent) >= _FAILURE_LIMIT


def _record_failure(ip: str) -> None:
    _failures.setdefault(ip, []).append(time.time())
    key = _throttle_key(ip)
    count = _upstash_command("incr", key)
    if count == 1:
        _upstash_command("expire", key, str(int(_FAILURE_WINDOW)))


def _is_admin_email(email: str | None) -> bool:
    if not email:
        return False
    configured = [e.strip().lower() for e in settings.admin_emails.split(",")]
    allowed = {*BOOTSTRAP_ADMIN_EMAILS, *[e for e in configured if e]}
    return email.lower() in allowed


def _registry_role(db, uid: str) -> str | None:
    """The uid's role from the dedicated admins registry, if any."""
    try:
        snapshot = db.collection("admins").document(uid).get()
        if not snapshot.exists:
            return None
        data = snapshot.to_dict() or {}
        role = data.get("role")
        return role if role in ("owner", "admin") else "admin"
    except Exception:
        return None


def _owner_registered(db) -> bool:
    try:
        rows = (
            db.collection("admins").where("role", "==", "owner").limit(1).get()
        )
        return len(rows) > 0
    except Exception:
        return False


async def authenticate_admin(
    service_token: str | None,
    admin_secret: str | None,
    authorization: str | None,
    client_ip: str,
    db_factory,
) -> tuple[str, str | None, str]:
    """Verify all three credentials; return (uid, email, role).

    Role resolution: the registry entry wins. The bootstrap
    owner email is a permanent owner-level recovery path (so the
    owner can never be locked out); claiming the panel writes
    the matching registry entry, after which the database is
    the visible source of truth.
    """
    if _throttled(client_ip):
        raise AdminAuthError(
            429, "TOO_MANY_ATTEMPTS", "Too many failed attempts. Try again shortly."
        )

    def fail(status: int, code: str, message: str) -> AdminAuthError:
        _record_failure(client_ip)
        return AdminAuthError(status, code, message)

    if not check_service_token(service_token):
        raise fail(401, "UNAUTHORIZED", "Invalid service token.")
    if not settings.admin_api_secret:
        raise AdminAuthError(
            503, "ADMIN_NOT_CONFIGURED", "The admin API is not configured."
        )
    if not admin_secret or not hmac.compare_digest(
        admin_secret, settings.admin_api_secret
    ):
        raise fail(401, "UNAUTHORIZED", "Invalid admin secret.")
    bearer = None
    if authorization and authorization.startswith("Bearer "):
        bearer = authorization[len("Bearer "):].strip()
    uid, failure = verify_id_token_detailed(bearer)
    email = None
    if uid:
        try:
            record = await asyncio.to_thread(firebase_auth().get_user, uid)
            email = record.email
        except Exception:
            email = None
        if email is None:
            # The token itself was verified by the SDK; its
            # claims are trustworthy for the email fallback.
            claims = decode_unverified_claims(bearer)
            claimed = claims.get("email")
            email = claimed if isinstance(claimed, str) else None
    else:
        # Fallback: verify against Google's public signing keys.
        # A damaged service-account key must never lock the
        # owner out of their own panel.
        pub_uid, pub_email, pub_failure = await asyncio.to_thread(
            verify_id_token_public, bearer
        )
        if pub_uid:
            uid, email, failure = pub_uid, pub_email, None
        else:
            failure = pub_failure or failure
    if not uid:
        # Explain the rejection with public identifiers only:
        # which project issued the token vs which project this
        # backend's credentials belong to, plus the failure kind.
        claims = decode_unverified_claims(bearer)
        token_project = claims.get("aud") or "unknown"
        backend_project = settings.firebase_project or "not configured"
        raise fail(
            401,
            "SIGNIN_UNVERIFIED",
            "Your sign-in couldn’t be verified "
            f"({failure or 'rejected'}). Token project: {token_project}. "
            f"Backend project: {backend_project}.",
        )
    # The database is only touched AFTER all three credentials
    # pass, so an unauthenticated probe gets a clean 401 even if
    # the service's database connection is not configured yet.
    db = db_factory()
    role = await asyncio.to_thread(_registry_role, db, uid)
    if role:
        return uid, email, role
    if _is_admin_email(email):
        # Bootstrap owner — and AUTO-PROVISIONING: write the
        # owner entry into the registry right now, so the
        # database records the owner without anyone creating
        # documents by hand. Best effort: admission never waits
        # on the write.
        try:
            await asyncio.to_thread(
                db.collection("admins").document(uid).set,
                {
                    "role": "owner",
                    "grantedBy": "auto-bootstrap",
                    "grantedAt": int(time.time() * 1000),
                },
            )
        except Exception:
            pass
        return uid, email, "owner"
    raise fail(403, "ADMIN_ONLY", "This area is available to administrators only.")


def _totals(data: dict | None) -> dict:
    data = data or {}
    return {
        field: data.get(field) if isinstance(data.get(field), (int, float)) else 0
        for field in TOTAL_FIELDS
    }


def _day_key(now: datetime) -> str:
    return now.strftime("%Y-%m-%d")


def _minute_key(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M")


def _resolve_emails(uids: list[str]) -> dict[str, str]:
    resolved: dict[str, str] = {}
    auth = firebase_auth()
    for uid in uids[:30]:
        try:
            record = auth.get_user(uid)
            if record.email:
                resolved[uid] = record.email
        except Exception:
            continue
    return resolved


def _section(issues: list, name: str, load, fallback):
    """Fault isolation for panel reads: a section whose backend
    read fails degrades to its empty shape and records the
    failure (exception class only) in issues, instead of taking
    the whole panel down with a 503."""
    try:
        return load()
    except Exception as error:  # noqa: BLE001 - the class name is the diagnostic
        issues.append({"section": name, "error": type(error).__name__})
        return fallback


def data_plane_status(db_factory, auth_factory) -> dict:
    """Live proof - beyond initialisation - that the Admin SDK
    can actually read Firestore and the Auth directory right
    now. A service-account key that was deleted or revoked
    still initialises cleanly, so only a real call tells the
    truth. Factories are called inside the guards so a client
    that fails to even build is reported per-branch too.
    Error class names only; never messages or values."""
    status: dict = {}
    try:
        db_factory().collection("admins").limit(1).get()
        status["firestore"] = {"live": True, "error": None}
    except Exception as error:  # noqa: BLE001
        status["firestore"] = {"live": False, "error": type(error).__name__}
    try:
        auth_factory().list_users(max_results=1)
        status["auth"] = {"live": True, "error": None}
    except Exception as error:  # noqa: BLE001
        status["auth"] = {"live": False, "error": type(error).__name__}
    return status


def get_overview(db) -> dict:
    now = datetime.now(timezone.utc)
    today = _day_key(now)
    issues: list[dict] = []

    def totals_for(day_key: str) -> dict:
        doc = db.collection("analytics_days").document(day_key).get()
        return _totals(doc.to_dict() if doc.exists else None)

    totals = _section(issues, "totals", lambda: totals_for(today), _totals(None))

    minute_keys = [
        _minute_key(now - timedelta(minutes=offset)) for offset in range(59, -1, -1)
    ]

    def load_minute_rows() -> list:
        # ONE range query feeds both the last-hour series and
        # the 24h/48h ranges. The previous design read every
        # minute document individually (60 reads per overview)
        # and then re-read 48 hours of them again for the
        # ranges — that burned the Firestore free-tier daily
        # read quota in a single evening of panel use.
        start48 = _minute_key(now - timedelta(hours=48))
        rows = []
        for doc in (
            db.collection("analytics_minutes")
            .where("minute", ">=", start48)
            .limit(4000)
            .get()
        ):
            data = doc.to_dict() or {}
            if isinstance(data.get("minute"), str):
                rows.append(data)
        return rows

    minute_rows = _section(issues, "minutes", load_minute_rows, [])
    by_minute = {row["minute"]: row for row in minute_rows}
    minutes = [{"minute": key, **_totals(by_minute.get(key))} for key in minute_keys]

    def load_models() -> list:
        rows = []
        for doc in db.collection("analytics_model_days").where("day", "==", today).get():
            data = doc.to_dict() or {}
            rows.append({"model": data.get("model") or "unknown", **_totals(data)})
        rows.sort(key=lambda row: row["totalTokens"], reverse=True)
        return rows

    models = _section(issues, "models", load_models, [])

    def load_top_users() -> list:
        rows = []
        for doc in db.collection("analytics_user_days").where("day", "==", today).get():
            data = doc.to_dict() or {}
            uid = data.get("uid") if isinstance(data.get("uid"), str) else doc.id
            rows.append({"uid": uid, **_totals(data)})
        rows.sort(key=lambda row: row["totalTokens"], reverse=True)
        return rows[:10]

    top_users = _section(issues, "topUsers", load_top_users, [])

    def load_events() -> list:
        rows = []
        event_docs = (
            db.collection("usageEvents")
            .order_by("ts", direction="DESCENDING")
            .limit(50)
            .get()
        )
        for doc in event_docs:
            data = doc.to_dict() or {}
            rows.append(
                {
                    "id": doc.id,
                    "ts": data.get("ts") if isinstance(data.get("ts"), (int, float)) else 0,
                    "uid": data.get("uid") or "",
                    "surface": data.get("surface") or "",
                    "model": data.get("model"),
                    "promptTokens": data.get("promptTokens") or 0,
                    "completionTokens": data.get("completionTokens") or 0,
                    "totalTokens": data.get("totalTokens") or 0,
                    "costUsd": data.get("costUsd") or 0,
                    "status": data.get("status") or "",
                }
            )
        return rows

    events = _section(issues, "recentEvents", load_events, [])

    try:
        emails = _resolve_emails(
            list({*[row["uid"] for row in top_users], *[row["uid"] for row in events]})
        )
    except Exception as error:  # noqa: BLE001
        issues.append({"section": "emails", "error": type(error).__name__})
        emails = {}
    for row in top_users:
        row["email"] = emails.get(row["uid"])
    for row in events:
        row["email"] = emails.get(row["uid"])

    def load_searches() -> list:
        rows = []
        for doc in (
            db.collection("searchEvents")
            .order_by("ts", direction="DESCENDING")
            .limit(20)
            .get()
        ):
            data = doc.to_dict() or {}
            rows.append(
                {
                    "query": data.get("query") or "",
                    "trigger": data.get("trigger") or "",
                    "provider": data.get("provider"),
                    "resultCount": data.get("resultCount") or 0,
                    "ts": data.get("ts") or 0,
                }
            )
        return rows

    searches = _section(issues, "recentSearches", load_searches, [])

    def load_errors() -> list:
        rows = []
        for doc in (
            db.collection("chatErrors")
            .order_by("ts", direction="DESCENDING")
            .limit(20)
            .get()
        ):
            data = doc.to_dict() or {}
            rows.append(
                {
                    "status": data.get("status"),
                    "model": data.get("model"),
                    "webInjected": data.get("webInjected") is True,
                    "error": (data.get("error") or "")[:240] or None,
                    "ts": data.get("ts") or 0,
                }
            )
        return rows

    errors = _section(issues, "recentErrors", load_errors, [])

    yesterday = _section(
        issues,
        "yesterday",
        lambda: totals_for(_day_key(now - timedelta(days=1))),
        _totals(None),
    )

    week_keys = [_day_key(now - timedelta(days=offset)) for offset in range(6, -1, -1)]

    def load_week() -> list:
        return [{"day": day, **totals_for(day)} for day in week_keys]

    week = _section(
        issues, "week", load_week, [{"day": day, **_totals(None)} for day in week_keys]
    )

    from . import watermark

    checks = settings.health()
    backend = {
        "executionMode": settings.execution_mode,
        "watermarkEngine": "c" if watermark.using_c_core() else "python",
        "integrations": checks,
        "integrationsOk": all(checks.values()),
    }

    def load_lifetime():
        lifetime = _totals(None)
        days = 0
        for doc in db.collection("analytics_days").limit(1000).get():
            data = doc.to_dict() or {}
            days += 1
            for field in TOTAL_FIELDS:
                value = data.get(field)
                if isinstance(value, (int, float)):
                    lifetime[field] += value
        return lifetime, days

    lifetime, days_with_data = _section(
        issues, "lifetime", load_lifetime, (_totals(None), 0)
    )

    return {
        "today": today,
        "totals": totals,
        "yesterday": yesterday,
        "week": week,
        "minutes": minutes,
        "models": models,
        "topUsers": top_users,
        "recentEvents": events,
        "recentSearches": searches,
        "recentErrors": errors,
        "backend": backend,
        "live": _live_streams(),
        "lifetime": lifetime,
        "lifetimeDays": days_with_data,
        "ranges": _ranges(db, now, minute_rows),
        "dataIssues": issues,
    }


def _ranges(db, now: datetime, rows: list | None = None) -> dict:
    """24h / 48h / 7d views. The 24h and 48h views aggregate
    the per-minute rollups into hourly (24h) and two-hourly
    (48h) buckets; 7d reuses the daily rollups. Best effort:
    a range that fails to load is simply absent. Callers that
    already fetched the minute rows pass them in, so the
    window is read from Firestore once, not twice."""
    ranges: dict = {}
    try:
        if rows is None:
            start48 = _minute_key(now - timedelta(hours=48))
            rows = []
            for doc in (
                db.collection("analytics_minutes")
                .where("minute", ">=", start48)
                .limit(4000)
                .get()
            ):
                data = doc.to_dict() or {}
                if isinstance(data.get("minute"), str):
                    rows.append(data)

        def aggregate(hours: int, bucket_hours: int) -> dict:
            cutoff = _minute_key(now - timedelta(hours=hours))
            totals = _totals(None)
            buckets: list[dict] = []
            bucket_count = hours // bucket_hours
            for index in range(bucket_count):
                start = now - timedelta(hours=hours - index * bucket_hours)
                buckets.append(
                    {"label": start.strftime("%H:%M"), **_totals(None)}
                )
            for data in rows:
                minute = data["minute"]
                if minute < cutoff:
                    continue
                for field in TOTAL_FIELDS:
                    value = data.get(field)
                    if isinstance(value, (int, float)):
                        totals[field] += value
                try:
                    moment = datetime.strptime(minute, "%Y-%m-%dT%H:%M").replace(
                        tzinfo=timezone.utc
                    )
                except ValueError:
                    continue
                age_hours = (now - moment).total_seconds() / 3600
                slot = int((hours - age_hours) // bucket_hours)
                if 0 <= slot < bucket_count:
                    for field in TOTAL_FIELDS:
                        value = data.get(field)
                        if isinstance(value, (int, float)):
                            buckets[slot][field] += value
            return {"totals": totals, "buckets": buckets}

        ranges["24h"] = aggregate(24, 1)
        ranges["48h"] = aggregate(48, 2)
    except Exception:
        pass
    return ranges


def get_logs(db) -> dict:
    """One realtime timeline merging the platform's own
    records: requests, web searches, model errors (with their
    status codes) and admin actions — newest first."""
    entries: list[dict] = []

    for doc in (
        db.collection("usageEvents")
        .order_by("ts", direction="DESCENDING")
        .limit(40)
        .get()
    ):
        data = doc.to_dict() or {}
        entries.append(
            {
                "id": f"req-{doc.id}",
                "ts": data.get("ts") if isinstance(data.get("ts"), (int, float)) else 0,
                "kind": "request",
                "uid": data.get("uid") or "",
                "summary": (
                    f"{data.get('surface') or 'chat'} · "
                    f"{data.get('model') or 'auto'} · "
                    f"{data.get('totalTokens') or 0} tokens"
                ),
                "code": data.get("status") or None,
            }
        )
    for doc in (
        db.collection("searchEvents")
        .order_by("ts", direction="DESCENDING")
        .limit(25)
        .get()
    ):
        data = doc.to_dict() or {}
        entries.append(
            {
                "id": f"search-{doc.id}",
                "ts": data.get("ts") if isinstance(data.get("ts"), (int, float)) else 0,
                "kind": "search",
                "uid": data.get("uid") or "",
                "summary": (
                    f"“{data.get('query') or ''}” · "
                    f"{data.get('resultCount') or 0} results · "
                    f"{data.get('provider') or '—'}"
                ),
                "code": None,
            }
        )
    for doc in (
        db.collection("chatErrors")
        .order_by("ts", direction="DESCENDING")
        .limit(25)
        .get()
    ):
        data = doc.to_dict() or {}
        entries.append(
            {
                "id": f"error-{doc.id}",
                "ts": data.get("ts") if isinstance(data.get("ts"), (int, float)) else 0,
                "kind": "error",
                "uid": data.get("uid") or "",
                "summary": (
                    f"{data.get('model') or 'model'} failed"
                    + (" (web on)" if data.get("webInjected") is True else "")
                    + f": {(data.get('error') or '')[:140]}"
                ),
                "code": data.get("status"),
            }
        )
    for doc in (
        db.collection("adminActions")
        .order_by("ts", direction="DESCENDING")
        .limit(25)
        .get()
    ):
        data = doc.to_dict() or {}
        entries.append(
            {
                "id": f"admin-{doc.id}",
                "ts": data.get("ts") if isinstance(data.get("ts"), (int, float)) else 0,
                "kind": "admin",
                "uid": data.get("targetUid") or "",
                "summary": f"{data.get('action') or 'action'} by {data.get('actorRole') or 'admin'}",
                "code": None,
            }
        )
    entries.sort(key=lambda row: row["ts"], reverse=True)
    entries = entries[:80]
    emails = _resolve_emails(list({row["uid"] for row in entries if row["uid"]}))
    for row in entries:
        row["email"] = emails.get(row["uid"])
    return {"entries": entries}


def _firestore_blob_stats(db) -> dict | None:
    """Usage of the app's fallback blob store (mediaStats/global,
    maintained by the main app's blob-store). None when there is
    no fallback store activity yet or no database handle."""
    if db is None:
        return None
    try:
        snapshot = db.collection("mediaStats").document("global").get()
    except Exception:
        return None
    if not snapshot.exists:
        return None
    data = snapshot.to_dict() or {}
    count = data.get("count")
    total_bytes = data.get("bytes")
    return {
        "configured": True,
        "source": "firestore",
        "objects": count if isinstance(count, (int, float)) else 0,
        "storageBytes": total_bytes if isinstance(total_bytes, (int, float)) else 0,
        "quotaBytes": 1_073_741_824,
    }


def get_storage(db=None) -> dict:
    """Media storage for the panel. Primary source is
    Cloudinary's usage API (plan, credits, consumption); when
    Cloudinary has no credentials here or its API rejects the
    call (the account is currently limited at the account
    level), the panel falls back to the app's Firestore blob
    store statistics so the card never just goes dark."""
    credentials = settings.cloudinary_credentials
    if credentials is None:
        return _firestore_blob_stats(db) or {"configured": False}
    cloud_name, api_key, api_secret = credentials
    import httpx

    try:
        response = httpx.get(
            f"https://api.cloudinary.com/v1_1/{cloud_name}/usage",
            auth=(api_key, api_secret),
            timeout=15,
        )
        response.raise_for_status()
        usage = response.json()
    except Exception as error:  # noqa: BLE001 - surfaced in the UI, not as a 503
        fallback = _firestore_blob_stats(db)
        if fallback is not None:
            fallback["cloudinaryError"] = (
                f"Cloudinary rejected the usage request ({type(error).__name__}) — "
                "the account is limited, so uploads are being stored in the "
                "fallback store below."
            )
            return fallback
        return {
            "configured": True,
            "error": (
                "Cloudinary rejected the request "
                f"({type(error).__name__}). Check CLOUDINARY_URL / the "
                "API key and secret on the backend project."
            ),
        }

    def section(name: str) -> dict:
        value = usage.get(name)
        return value if isinstance(value, dict) else {}

    credits = section("credits")
    return {
        "configured": True,
        "source": "cloudinary",
        "plan": usage.get("plan"),
        "cloudName": cloud_name,
        "creditsLimit": credits.get("limit"),
        "creditsUsed": credits.get("usage"),
        "creditsUsedPercent": credits.get("used_percent"),
        "storageBytes": section("storage").get("usage"),
        "bandwidthBytes": section("bandwidth").get("usage"),
        "objects": section("objects").get("count"),
        "requests": usage.get("requests"),
        "transformations": section("transformations").get("usage"),
        "updatedAt": usage.get("last_updated"),
    }


def _cloudinary_sign(params: dict, api_secret: str) -> str:
    """Cloudinary's api_sign_request: SHA-1 of the sorted
    key=value pairs joined with &, with the secret appended."""
    parts = []
    for key in sorted(params):
        value = params[key]
        if value is None or value == "" or key in ("file", "api_key", "signature", "resource_type", "cloud_name"):
            continue
        if isinstance(value, bool):
            value = "true" if value else "false"
        parts.append(f"{key}={value}")
    return hashlib.sha1(("&".join(parts) + api_secret).encode("utf-8")).hexdigest()


def _media_owner(public_id: str) -> str | None:
    """Every app asset names its owner: xyro/avatars/{uid}/…,
    xyro/generated/{uid}/…, or xyro_{uid}_{chatId}_{assetId}."""
    parts = public_id.split("/")
    if len(parts) >= 3 and parts[0] == "xyro" and parts[1] in ("avatars", "generated"):
        return parts[2]
    if public_id.startswith("xyro_"):
        segments = public_id.split("_")
        if len(segments) >= 2 and segments[1]:
            return segments[1]
    return None


def list_media(prefix: str = "") -> dict:
    """Cloudinary asset inventory for the panel's Media tab:
    generated images, avatars and user files across delivery
    types, newest first, with owner uids/emails resolved.
    Previews are only exposed for public-delivery assets;
    private assets are downloaded through the gated proxy."""
    credentials = settings.cloudinary_credentials
    if credentials is None:
        return {"configured": False, "resources": []}
    cloud_name, api_key, api_secret = credentials
    resources: list[dict] = []
    errors: list[str] = []
    for resource_type, delivery_type in (
        ("image", "authenticated"),
        ("image", "upload"),
        ("raw", "authenticated"),
        ("raw", "upload"),
    ):
        try:
            params: dict = {"max_results": 100}
            if prefix:
                params["prefix"] = prefix
            response = httpx.get(
                f"https://api.cloudinary.com/v1_1/{cloud_name}/resources/{resource_type}/{delivery_type}",
                params=params,
                auth=(api_key, api_secret),
                timeout=20,
            )
            response.raise_for_status()
            for item in response.json().get("resources", []):
                public_id = item.get("public_id")
                if not isinstance(public_id, str):
                    continue
                resources.append(
                    {
                        "publicId": public_id,
                        "resourceType": item.get("resource_type") or resource_type,
                        "deliveryType": item.get("type") or delivery_type,
                        "format": item.get("format"),
                        "bytes": item.get("bytes") if isinstance(item.get("bytes"), (int, float)) else None,
                        "createdAt": item.get("created_at"),
                        "ownerUid": _media_owner(public_id),
                        "previewUrl": item.get("secure_url")
                        if (item.get("type") or delivery_type) == "upload"
                        else None,
                    }
                )
        except Exception as error:  # noqa: BLE001 - partial inventory beats none
            errors.append(f"{resource_type}/{delivery_type}: {type(error).__name__}")
    resources.sort(key=lambda row: row.get("createdAt") or "", reverse=True)
    emails = _resolve_emails(list({row["ownerUid"] for row in resources if row["ownerUid"]}))
    for row in resources:
        row["ownerEmail"] = emails.get(row["ownerUid"]) if row["ownerUid"] else None
    result: dict = {"configured": True, "resources": resources[:200]}
    if errors and not resources:
        result["error"] = (
            "Cloudinary rejected the media listing (" + "; ".join(errors) + ")."
        )
    elif errors:
        result["error"] = "Some media couldn’t be listed (" + "; ".join(errors) + ")."
    return result


def _audit_media(db, actor_uid: str, actor_role: str, action: str, public_id: str, owner_uid) -> None:
    try:
        db.collection("adminActions").add(
            {
                "action": action,
                "actorUid": actor_uid,
                "actorRole": actor_role,
                "targetUid": owner_uid,
                "publicId": public_id,
                "ts": int(time.time() * 1000),
            }
        )
    except Exception:
        pass


def delete_media(db, actor_uid: str, actor_role: str, public_id: str, resource_type: str, delivery_type: str) -> dict:
    """Delete one Cloudinary asset (audited)."""
    credentials = settings.cloudinary_credentials
    if credentials is None:
        raise AdminAuthError(503, "MEDIA_NOT_CONFIGURED", "Cloudinary isn’t configured on the backend.")
    if resource_type not in ("image", "raw") or delivery_type not in ("authenticated", "upload"):
        raise AdminAuthError(400, "INVALID_MEDIA", "That media reference isn’t valid.")
    cloud_name, api_key, api_secret = credentials
    try:
        response = httpx.request(
            "DELETE",
            f"https://api.cloudinary.com/v1_1/{cloud_name}/resources/{resource_type}/{delivery_type}",
            params=[("public_ids[]", public_id)],
            auth=(api_key, api_secret),
            timeout=20,
        )
        response.raise_for_status()
        deleted = (response.json().get("deleted") or {}).get(public_id)
    except AdminAuthError:
        raise
    except Exception as error:  # noqa: BLE001
        raise AdminAuthError(502, "MEDIA_DELETE_FAILED", f"Cloudinary couldn’t delete that file ({type(error).__name__}).") from error
    if deleted != "deleted":
        raise AdminAuthError(404, "MEDIA_NOT_FOUND", "That file is no longer in Cloudinary.")
    _audit_media(db, actor_uid, actor_role, "media_delete", public_id, _media_owner(public_id))
    return {"deleted": True, "publicId": public_id}


def upload_media(db, actor_uid: str, actor_role: str, filename: str, data: bytes, resource_type: str) -> dict:
    """Admin upload into xyro/admin-uploads (signed, audited)."""
    credentials = settings.cloudinary_credentials
    if credentials is None:
        raise AdminAuthError(503, "MEDIA_NOT_CONFIGURED", "Cloudinary isn’t configured on the backend.")
    if resource_type not in ("image", "raw"):
        raise AdminAuthError(400, "INVALID_MEDIA", "Choose an image or a raw file upload.")
    if len(data) > 10 * 1024 * 1024:
        raise AdminAuthError(413, "FILE_TOO_LARGE", "Admin uploads are capped at 10 MB.")
    cloud_name, api_key, api_secret = credentials
    timestamp = int(time.time())
    sign_params = {"folder": "xyro/admin-uploads", "timestamp": timestamp}
    form = {
        "api_key": api_key,
        "timestamp": str(timestamp),
        "folder": "xyro/admin-uploads",
        "signature": _cloudinary_sign(sign_params, api_secret),
    }
    try:
        response = httpx.post(
            f"https://api.cloudinary.com/v1_1/{cloud_name}/{resource_type}/upload",
            data=form,
            files={"file": (filename or "upload", data)},
            timeout=30,
        )
        response.raise_for_status()
        item = response.json()
    except Exception as error:  # noqa: BLE001
        raise AdminAuthError(502, "MEDIA_UPLOAD_FAILED", f"Cloudinary couldn’t take that upload ({type(error).__name__}).") from error
    public_id = item.get("public_id")
    _audit_media(db, actor_uid, actor_role, "media_upload", str(public_id), None)
    return {
        "publicId": public_id,
        "resourceType": item.get("resource_type") or resource_type,
        "deliveryType": item.get("type") or "upload",
        "format": item.get("format"),
        "bytes": item.get("bytes"),
        "createdAt": item.get("created_at"),
        "ownerUid": None,
        "ownerEmail": None,
        "previewUrl": item.get("secure_url"),
    }


def download_media(public_id: str, resource_type: str, format_: str, delivery_type: str) -> tuple[bytes, str]:
    """Fetch an asset's bytes through Cloudinary's signed
    download endpoint (works for authenticated assets too)."""
    credentials = settings.cloudinary_credentials
    if credentials is None:
        raise AdminAuthError(503, "MEDIA_NOT_CONFIGURED", "Cloudinary isn’t configured on the backend.")
    cloud_name, api_key, api_secret = credentials
    timestamp = int(time.time())
    sign_params = {
        "public_id": public_id,
        "format": format_,
        "type": delivery_type,
        "timestamp": timestamp,
    }
    query = {
        **sign_params,
        "api_key": api_key,
        "signature": _cloudinary_sign(sign_params, api_secret),
    }
    try:
        response = httpx.get(
            f"https://api.cloudinary.com/v1_1/{cloud_name}/{resource_type}/download",
            params=query,
            timeout=30,
            follow_redirects=True,
        )
        response.raise_for_status()
    except Exception as error:  # noqa: BLE001
        raise AdminAuthError(502, "MEDIA_DOWNLOAD_FAILED", f"Cloudinary couldn’t deliver that file ({type(error).__name__}).") from error
    return response.content, response.headers.get("content-type", "application/octet-stream")


def _live_streams() -> dict:
    """What's happening right now in the Realtime Database:
    how many chat stream nodes exist and how many are actively
    generating. Best effort — a realtime hiccup must never take
    the overview down with it."""
    try:
        from .firebase import rtdb_ref

        snapshot = rtdb_ref("chatStreams").get() or {}
        streams = 0
        generating = 0
        if isinstance(snapshot, dict):
            for uid_node in snapshot.values():
                if not isinstance(uid_node, dict):
                    continue
                for node in uid_node.values():
                    streams += 1
                    if isinstance(node, dict) and node.get("status") == "generating":
                        generating += 1
        return {"streams": streams, "generating": generating}
    except Exception:
        return {"streams": 0, "generating": 0}


def get_audit(db) -> dict:
    """The adminActions audit trail, newest first, with the
    actors' and targets' emails resolved for display."""
    entries = []
    docs = (
        db.collection("adminActions")
        .order_by("ts", direction="DESCENDING")
        .limit(50)
        .get()
    )
    for doc in docs:
        data = doc.to_dict() or {}
        entries.append(
            {
                "id": doc.id,
                "actorUid": data.get("actorUid") or "",
                "actorRole": data.get("actorRole"),
                "targetUid": data.get("targetUid") or "",
                "action": data.get("action") or "",
                "ts": data.get("ts") or 0,
            }
        )
    emails = _resolve_emails(
        list({*[row["actorUid"] for row in entries], *[row["targetUid"] for row in entries]})
    )
    for row in entries:
        row["actorEmail"] = emails.get(row["actorUid"])
        row["targetEmail"] = emails.get(row["targetUid"])
    return {"entries": entries}


def get_users(db, viewer_uid: str, viewer_role: str, query: str = "") -> dict:
    now = datetime.now(timezone.utc)
    today = _day_key(now)
    auth = firebase_auth()

    profiles: dict[str, dict] = {}
    for doc in db.collection("users").limit(500).get():
        profiles[doc.id] = doc.to_dict() or {}

    registry: dict[str, str] = {}
    for doc in db.collection("admins").limit(500).get():
        data = doc.to_dict() or {}
        role = data.get("role")
        registry[doc.id] = role if role in ("owner", "admin") else "admin"

    usage: dict[str, dict] = {}
    for doc in db.collection("analytics_user_days").where("day", "==", today).get():
        data = doc.to_dict() or {}
        uid = data.get("uid") if isinstance(data.get("uid"), str) else doc.id
        usage[uid] = _totals(data)

    lifetime_usage: dict[str, dict] = {}
    for doc in db.collection("analytics_user_days").limit(3000).get():
        data = doc.to_dict() or {}
        uid = data.get("uid") if isinstance(data.get("uid"), str) else None
        if not uid:
            continue
        entry = lifetime_usage.setdefault(uid, {"requests": 0, "totalTokens": 0})
        if isinstance(data.get("requests"), (int, float)):
            entry["requests"] += data["requests"]
        if isinstance(data.get("totalTokens"), (int, float)):
            entry["totalTokens"] += data["totalTokens"]

    needle = query.strip().lower()
    searching = len(needle) >= 2
    users = []
    page = auth.list_users(max_results=1000 if searching else 200)
    for record in page.iterate_all():
        profile = profiles.get(record.uid) or {}
        if searching:
            # Directory-wide search: keep only matches on email,
            # display name (Auth or profile) or uid — the target
            # may sit far beyond the first page of the directory.
            haystacks = (
                (record.email or "").lower(),
                (record.display_name or "").lower(),
                record.uid.lower(),
                str(profile.get("displayName") or "").lower(),
            )
            if not any(needle in hay for hay in haystacks):
                continue
        totals = usage.get(record.uid) or _totals(None)
        metadata = record.user_metadata
        role = registry.get(record.uid)
        if role is None and record.uid == viewer_uid:
            # The viewer may be in via the bootstrap owner path
            # before claiming a registry entry.
            role = viewer_role
        users.append(
            {
                "uid": record.uid,
                "email": record.email,
                "displayName": record.display_name
                or (profile.get("displayName") if isinstance(profile.get("displayName"), str) else None),
                "photoUrl": getattr(record, "photo_url", None)
                or (profile.get("photoURL") if isinstance(profile.get("photoURL"), str) else None),
                "emailVerified": bool(record.email_verified),
                "disabled": bool(record.disabled),
                "admin": role is not None,
                "role": role,
                "createdAt": getattr(metadata, "creation_timestamp", None),
                "lastSignInAt": getattr(metadata, "last_sign_in_timestamp", None),
                "requestsToday": totals["requests"],
                "totalTokensToday": totals["totalTokens"],
                "costUsdToday": totals["costUsd"],
                "lifetimeRequests": (lifetime_usage.get(record.uid) or {}).get("requests", 0),
                "lifetimeTokens": (lifetime_usage.get(record.uid) or {}).get("totalTokens", 0),
            }
        )
        if searching:
            if len(users) >= 100:
                break
        elif len(users) >= 200:
            break
    role_rank = {"owner": 0, "admin": 1}
    users.sort(
        key=lambda row: (role_rank.get(row["role"], 2), -row["totalTokensToday"])
    )
    return {
        "today": today,
        "users": users,
        # The directory read caps at 200 accounts; hitting the
        # cap means there may be more. (The Auth page object
        # exposes next_page_token, but iterate_all() consumes
        # the pages, so the cap is the honest signal.)
        "truncated": len(users) >= 200,
        "query": query if searching else "",
        "viewer": {
            "uid": viewer_uid,
            "role": viewer_role,
            # False when the viewer is in through the bootstrap
            # owner path and has not claimed a registry entry yet.
            "registered": viewer_uid in registry,
            # Whether the backend has an OWNER_SECRET configured —
            # the panel warns the owner when privilege changes
            # would fail closed without one.
            "ownerSecretConfigured": bool(owner_secret()),
        },
    }


ACTIONS = (
    "promote",
    "demote",
    "disable",
    "enable",
    "delete",
    "reset-link",
    "sign-out-all",
    "verify-email",
    "unverify-email",
)


def _snapshot_deleted_user(
    db, actor_uid: str, actor_role: str, target_uid: str, target_role: str | None
) -> None:
    auth = firebase_auth()
    record = auth.get_user(target_uid)
    metadata = record.user_metadata
    profile_doc = db.collection("users").document(target_uid).get()
    profile = profile_doc.to_dict() if profile_doc.exists else {}

    lifetime = _totals(None)
    usage_days = 0
    for doc in (
        db.collection("analytics_user_days").where("uid", "==", target_uid).get()
    ):
        data = doc.to_dict() or {}
        usage_days += 1
        for field in TOTAL_FIELDS:
            value = data.get(field)
            if isinstance(value, (int, float)):
                lifetime[field] += value

    def sub_count(name: str, cap: int) -> int:
        return len(
            db.collection("users")
            .document(target_uid)
            .collection(name)
            .limit(cap)
            .get()
        )

    chat_titles = []
    for doc in (
        db.collection("users").document(target_uid).collection("chats").limit(200).get()
    ):
        data = doc.to_dict() or {}
        if isinstance(data.get("title"), str):
            chat_titles.append(data["title"])

    db.collection("deletedUsers").document(target_uid).set(
        {
            "uid": target_uid,
            "email": record.email,
            "displayName": record.display_name
            or (profile.get("displayName") if isinstance(profile.get("displayName"), str) else None),
            "role": target_role,
            "accountCreatedAt": getattr(metadata, "creation_timestamp", None),
            "lastSignInAt": getattr(metadata, "last_sign_in_timestamp", None),
            "deletedAt": int(time.time() * 1000),
            "deletedBy": actor_uid,
            "deletedByRole": actor_role,
            "profile": profile,
            "stats": {
                "chats": len(chat_titles),
                "chatTitles": chat_titles[:50],
                "apiKeys": sub_count("apiKeys", 100),
                "devices": sub_count("devices", 100),
                "lifetimeRequests": lifetime["requests"],
                "lifetimeTokens": lifetime["totalTokens"],
                "lifetimeCostUsd": lifetime["costUsd"],
                "usageDays": usage_days,
            },
        }
    )


def get_trash(db) -> dict:
    """The deleted-accounts archive: who was removed, when, by
    whom, and how much data went with them — plus the totals
    across the whole trash."""
    entries = []
    docs = (
        db.collection("deletedUsers")
        .order_by("deletedAt", direction="DESCENDING")
        .limit(100)
        .get()
    )
    totals = {"accounts": 0, "chats": 0, "lifetimeTokens": 0, "lifetimeRequests": 0}
    for doc in docs:
        data = doc.to_dict() or {}
        stats = data.get("stats") if isinstance(data.get("stats"), dict) else {}
        entry = {
            "uid": data.get("uid") or doc.id,
            "email": data.get("email"),
            "displayName": data.get("displayName"),
            "role": data.get("role"),
            "deletedAt": data.get("deletedAt") or 0,
            "deletedByRole": data.get("deletedByRole"),
            "chats": stats.get("chats") or 0,
            "apiKeys": stats.get("apiKeys") or 0,
            "devices": stats.get("devices") or 0,
            "lifetimeTokens": stats.get("lifetimeTokens") or 0,
            "lifetimeRequests": stats.get("lifetimeRequests") or 0,
            "lifetimeCostUsd": stats.get("lifetimeCostUsd") or 0,
        }
        entries.append(entry)
        totals["accounts"] += 1
        totals["chats"] += entry["chats"]
        totals["lifetimeTokens"] += entry["lifetimeTokens"]
        totals["lifetimeRequests"] += entry["lifetimeRequests"]
    return {"entries": entries, "totals": totals}


FLAG_REVIEW_STATUSES = ("dismissed", "actioned")


def get_flags(db, status_filter: str = "") -> dict:
    """Safety flags for admin review, newest first. Emails are
    resolved from the Auth directory; a flag whose account is
    gone still lists (email null)."""
    query = db.collection("safetyFlags").order_by(
        "ts", direction="DESCENDING"
    )
    docs = query.limit(200).get()
    auth = firebase_auth()
    emails: dict[str, str | None] = {}
    flags: list[dict] = []
    pending = 0
    for doc in docs:
        data = doc.to_dict() or {}
        status = data.get("status") if isinstance(data.get("status"), str) else "pending"
        if status == "pending":
            pending += 1
        if status_filter and status != status_filter:
            continue
        uid = data.get("uid") if isinstance(data.get("uid"), str) else ""
        if uid and uid not in emails:
            try:
                emails[uid] = auth.get_user(uid).email
            except Exception:
                emails[uid] = None
        flags.append(
            {
                "id": doc.id,
                "uid": uid,
                "email": emails.get(uid),
                "chatId": data.get("chatId") if isinstance(data.get("chatId"), str) else "",
                "prompt": data.get("prompt") if isinstance(data.get("prompt"), str) else "",
                "category": data.get("category") if isinstance(data.get("category"), str) else "other",
                "signal": data.get("signal") if isinstance(data.get("signal"), str) else "",
                "model": data.get("model") if isinstance(data.get("model"), str) else None,
                "status": status,
                "ts": data.get("ts") if isinstance(data.get("ts"), (int, float)) else None,
                "reviewedBy": data.get("reviewedBy") if isinstance(data.get("reviewedBy"), str) else None,
            }
        )
        if len(flags) >= 100:
            break
    return {"flags": flags, "pendingCount": pending}


def review_flag(db, actor_uid: str, actor_role: str, flag_id: str, new_status: str) -> dict:
    """Record the reviewing admin's decision on a flag."""
    if new_status not in FLAG_REVIEW_STATUSES:
        raise AdminAuthError(400, "INVALID_STATUS", "Choose dismissed or actioned.")
    ref = db.collection("safetyFlags").document(flag_id)
    snapshot = ref.get()
    if not snapshot.exists:
        raise AdminAuthError(404, "FLAG_NOT_FOUND", "That flag no longer exists.")
    from firebase_admin import firestore

    ref.set(
        {
            "status": new_status,
            "reviewedBy": actor_uid,
            "reviewedByRole": actor_role,
            "reviewedAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )
    try:
        db.collection("adminActions").add(
            {
                "action": "flag_review",
                "actorUid": actor_uid,
                "actorRole": actor_role,
                "targetUid": (snapshot.to_dict() or {}).get("uid"),
                "flagId": flag_id,
                "decision": new_status,
                "ts": int(time.time() * 1000),
            }
        )
    except Exception:
        pass
    return {"flagId": flag_id, "status": new_status}


def get_user_chats(db, uid: str) -> dict:
    """A user's chat list for admin inspection (owner request:
    admins may read user chats to review flagged content)."""
    docs = (
        db.collection("users")
        .document(uid)
        .collection("chats")
        .order_by("updatedAt", direction="DESCENDING")
        .limit(50)
        .get()
    )
    chats = []
    for doc in docs:
        data = doc.to_dict() or {}
        chats.append(
            {
                "id": doc.id,
                "title": data.get("title") if isinstance(data.get("title"), str) else "Untitled chat",
                "lastMessagePreview": data.get("lastMessagePreview")
                if isinstance(data.get("lastMessagePreview"), str)
                else "",
                "updatedAt": _ms(data.get("updatedAt")),
                "createdAt": _ms(data.get("createdAt")),
            }
        )
    return {"chats": chats}


def get_user_chat_messages(db, actor_uid: str, actor_role: str, uid: str, chat_id: str) -> dict:
    """The messages of one user chat. Viewing a user's chat is
    itself audited to adminActions — reading private
    conversations must leave a trail."""
    chat_ref = db.collection("users").document(uid).collection("chats").document(chat_id)
    if not chat_ref.get().exists:
        raise AdminAuthError(404, "CHAT_NOT_FOUND", "That chat no longer exists.")
    docs = chat_ref.collection("messages").order_by("createdAt").limit(200).get()
    messages = []
    for doc in docs:
        data = doc.to_dict() or {}
        content = data.get("content") if isinstance(data.get("content"), str) else ""
        messages.append(
            {
                "id": doc.id,
                "role": data.get("role") if isinstance(data.get("role"), str) else "user",
                "content": content[:4000],
                "status": data.get("status") if isinstance(data.get("status"), str) else None,
                "provider": data.get("provider") if isinstance(data.get("provider"), str) else None,
                "createdAt": _ms(data.get("createdAt")),
            }
        )
    try:
        db.collection("adminActions").add(
            {
                "action": "view_chat",
                "actorUid": actor_uid,
                "actorRole": actor_role,
                "targetUid": uid,
                "chatId": chat_id,
                "ts": int(time.time() * 1000),
            }
        )
    except Exception:
        pass
    return {"messages": messages}


def get_user_detail(db, uid: str) -> dict:
    """Everything the console shows about one account: identity,
    a week of usage, devices, recent chats, API keys and recent
    security/API activity. Read-only; assembled from the same
    collections the product itself writes."""
    auth = firebase_auth()
    try:
        record = auth.get_user(uid)
    except Exception:
        raise AdminAuthError(404, "USER_NOT_FOUND", "That account no longer exists.")
    metadata = record.user_metadata
    profile_doc = db.collection("users").document(uid).get()
    profile = profile_doc.to_dict() if profile_doc.exists else {}

    now = datetime.now(timezone.utc)
    week = []
    day_docs = (
        db.collection("analytics_user_days").where("uid", "==", uid).get()
    )
    by_day = {}
    for doc in day_docs:
        data = doc.to_dict() or {}
        if isinstance(data.get("day"), str):
            by_day[data["day"]] = _totals(data)
    for offset in range(6, -1, -1):
        day = _day_key(now - timedelta(days=offset))
        week.append({"day": day, **(by_day.get(day) or _totals(None))})

    def sub(name: str):
        return db.collection("users").document(uid).collection(name)

    chats = []
    chat_docs = sub("chats").limit(200).get()
    for doc in chat_docs:
        data = doc.to_dict() or {}
        chats.append(
            {
                "id": doc.id,
                "title": data.get("title") if isinstance(data.get("title"), str) else None,
                "updatedAt": data.get("updatedAt") if isinstance(data.get("updatedAt"), (int, float)) else None,
                "pinned": data.get("pinned") is True,
            }
        )
    chats.sort(key=lambda row: row["updatedAt"] or 0, reverse=True)

    devices = []
    for doc in sub("devices").limit(50).get():
        data = doc.to_dict() or {}
        devices.append(
            {
                "id": doc.id,
                "label": data.get("label") if isinstance(data.get("label"), str) else None,
                "platform": data.get("platform") if isinstance(data.get("platform"), str) else None,
                "lastSeenAt": data.get("lastSeenAt") if isinstance(data.get("lastSeenAt"), (int, float)) else None,
                "signIns": data.get("signIns") if isinstance(data.get("signIns"), int) else None,
            }
        )

    api_keys = []
    for doc in sub("apiKeys").limit(25).get():
        data = doc.to_dict() or {}
        api_keys.append(
            {
                "id": doc.id,
                "name": data.get("name") if isinstance(data.get("name"), str) else None,
                "revoked": data.get("revoked") is True,
                "createdAt": data.get("createdAt") if isinstance(data.get("createdAt"), (int, float)) else None,
                "lastUsedAt": data.get("lastUsedAt") if isinstance(data.get("lastUsedAt"), (int, float)) else None,
            }
        )

    security = []
    for doc in (
        sub("securityEvents").order_by("ts", direction="DESCENDING").limit(8).get()
    ):
        data = doc.to_dict() or {}
        security.append(
            {
                "type": data.get("type") if isinstance(data.get("type"), str) else (data.get("event") if isinstance(data.get("event"), str) else "event"),
                "ts": data.get("ts") if isinstance(data.get("ts"), (int, float)) else 0,
                "newDevice": data.get("newDevice") is True,
            }
        )

    api_events = []
    for doc in (
        sub("apiEvents").order_by("ts", direction="DESCENDING").limit(8).get()
    ):
        data = doc.to_dict() or {}
        api_events.append(
            {
                "model": data.get("model") if isinstance(data.get("model"), str) else None,
                "totalTokens": data.get("totalTokens") if isinstance(data.get("totalTokens"), int) else 0,
                "status": data.get("status") if isinstance(data.get("status"), (int, str)) else None,
                "ts": data.get("ts") if isinstance(data.get("ts"), (int, float)) else 0,
            }
        )

    providers = []
    for info in record.provider_data or []:
        provider_id = getattr(info, "provider_id", None)
        if isinstance(provider_id, str):
            providers.append(provider_id)

    lifetime = _totals(None)
    for day_totals in by_day.values():
        for field in TOTAL_FIELDS:
            lifetime[field] += day_totals[field]

    return {
        "uid": uid,
        "email": record.email,
        "displayName": record.display_name
        or (profile.get("displayName") if isinstance(profile.get("displayName"), str) else None),
        "emailVerified": bool(record.email_verified),
        "disabled": bool(record.disabled),
        "role": _registry_role(db, uid),
        "providers": providers,
        "createdAt": getattr(metadata, "creation_timestamp", None),
        "lastSignInAt": getattr(metadata, "last_sign_in_timestamp", None),
        "developer": sub("developerProfile").document("main").get().exists,
        "week": week,
        "lifetime": lifetime,
        "chats": {"count": len(chats), "recent": chats[:6]},
        "devices": devices,
        "apiKeys": api_keys,
        "securityEvents": security,
        "apiEvents": api_events,
    }


SECRET_GATED_ACTIONS = ("promote", "demote", "delete")


def _require_owner_secret(provided: str | None) -> None:
    """Step-up check for privilege changes: the caller must present
    the OWNER_SECRET configured on this backend. Fails CLOSED when
    the secret is not configured at all — granting admin must never
    silently work without the owner's password layer."""
    expected = owner_secret()
    if not expected:
        raise AdminAuthError(
            503,
            "OWNER_SECRET_NOT_CONFIGURED",
            "The owner secret is not set on the backend yet. Add OWNER_SECRET "
            "to the backend project and redeploy, then try again.",
        )
    if not provided or not hmac.compare_digest(provided.strip(), expected):
        raise AdminAuthError(
            403,
            "OWNER_SECRET_INVALID",
            "The owner secret is incorrect — nothing was changed.",
        )


def verify_owner_secret(actor_role: str, provided: str | None) -> dict:
    """Check an owner-secret attempt WITHOUT changing anything.

    The panel's Owner tab uses this so the owner can confirm the
    secret works and see precisely which failure applies (not
    configured on the backend vs. simply incorrect) instead of
    discovering it mid-action."""
    if actor_role != "owner":
        raise AdminAuthError(
            403, "OWNER_ONLY", "Only the owner has an owner secret."
        )
    _require_owner_secret(provided)
    return {"success": True, "configured": True}


def patch_user(
    db,
    actor_uid: str,
    actor_role: str,
    actor_email: str | None,
    target_uid: str,
    action: str,
    owner_secret_value: str | None = None,
) -> dict:
    if action not in ACTIONS:
        raise AdminAuthError(400, "INVALID_ACTION", "A valid action is required.")
    if target_uid == actor_uid and action in ("demote", "disable", "delete"):
        raise AdminAuthError(
            400,
            "SELF_ACTION",
            "You can’t demote, disable or delete your own admin account.",
        )
    target_role = _registry_role(db, target_uid)
    if action in SECRET_GATED_ACTIONS:
        # Privilege changes (grant / revoke admin, delete account)
        # need BOTH the owner role AND the owner secret — a signed-in
        # owner session alone is never enough.
        if actor_role != "owner":
            raise AdminAuthError(
                403,
                "OWNER_ONLY",
                "Only the owner can grant or revoke admin access or delete accounts.",
            )
        _require_owner_secret(owner_secret_value)
    if action == "delete":
        # Permanent account deletion is the owner's power alone.
        if actor_role != "owner":
            raise AdminAuthError(
                403,
                "OWNER_ONLY",
                "Only the owner can delete accounts.",
            )
        if target_role == "owner":
            raise AdminAuthError(
                400, "OWNER_PROTECTED", "The owner’s account can’t be deleted."
            )
        # Trash snapshot FIRST: the account's identity, profile
        # and data-volume measurements move to deletedUsers so
        # the owner can see exactly how much data was trashed.
        # Message contents are purged with the account — the
        # snapshot keeps metadata and counts, not conversations.
        try:
            _snapshot_deleted_user(db, actor_uid, actor_role, target_uid, target_role)
        except Exception:
            pass
        try:
            db.collection("admins").document(target_uid).delete()
        except Exception:
            pass
        firebase_auth().delete_user(target_uid)
        try:
            db.collection("users").document(target_uid).delete()
        except Exception:
            pass
        try:
            db.collection("adminActions").add(
                {
                    "actorUid": actor_uid,
                    "actorRole": actor_role,
                    "targetUid": target_uid,
                    "action": "delete",
                    "ts": int(time.time() * 1000),
                }
            )
        except Exception:
            pass
        return {"success": True, "uid": target_uid, "action": "delete"}
    result: dict = {"success": True, "uid": target_uid, "action": action}
    if action in ("verify-email", "unverify-email"):
        # Email verification is a routine support power: ANY
        # admin (not just the owner) may verify — or un-verify —
        # ANY account, including another admin's. The panel uses
        # it to unblock users whose verification mail never
        # arrived. Audited below like every other action.
        try:
            firebase_auth().get_user(target_uid)
        except Exception:
            raise AdminAuthError(
                404, "USER_NOT_FOUND", "That account no longer exists."
            )
        firebase_auth().update_user(
            target_uid, email_verified=(action == "verify-email")
        )
        result["emailVerified"] = action == "verify-email"
    elif action in ("reset-link", "sign-out-all"):
        # Full-control actions. Touching the OWNER's account
        # this way stays the owner's own power.
        if target_role in ("owner", "admin") and actor_role != "owner":
            raise AdminAuthError(
                403,
                "OWNER_ONLY",
                "Only the owner can do that on an admin’s or the owner’s account.",
            )
        if action == "reset-link":
            try:
                record = firebase_auth().get_user(target_uid)
            except Exception:
                raise AdminAuthError(
                    404, "USER_NOT_FOUND", "That account no longer exists."
                )
            if not record.email:
                raise AdminAuthError(
                    400,
                    "NO_EMAIL",
                    "That account has no email address to send a reset link to.",
                )
            result["link"] = firebase_auth().generate_password_reset_link(
                record.email
            )
        else:
            firebase_auth().revoke_refresh_tokens(target_uid)
    elif action in ("promote", "demote"):
        # Granting and revoking admin access is the owner's
        # power alone — enforced here, not just hidden in the UI.
        if actor_role != "owner":
            raise AdminAuthError(
                403,
                "OWNER_ONLY",
                "Only the owner can grant or revoke admin access.",
            )
        if action == "demote" and target_role == "owner":
            raise AdminAuthError(
                400, "OWNER_PROTECTED", "The owner’s access can’t be removed."
            )
        if action == "promote":
            # The bootstrap owner claiming their own entry is
            # recorded as owner; every other grant is a plain
            # admin, and only when no conflicting owner exists.
            granted_role = "admin"
            if target_uid == actor_uid and _is_admin_email(actor_email):
                if not _owner_registered(db) or target_role == "owner":
                    granted_role = "owner"
            db.collection("admins").document(target_uid).set(
                {
                    "role": granted_role,
                    "grantedBy": actor_uid,
                    "grantedAt": int(time.time() * 1000),
                }
            )
        else:
            # Revocation deletes the registry entry and takes
            # effect on the target's very next request.
            db.collection("admins").document(target_uid).delete()
    else:
        if target_role in ("owner", "admin") and actor_role != "owner":
            raise AdminAuthError(
                403,
                "OWNER_ONLY",
                "Only the owner can disable an admin’s or the owner’s account.",
            )
        firebase_auth().update_user(target_uid, disabled=(action == "disable"))
    try:
        db.collection("adminActions").add(
            {
                "actorUid": actor_uid,
                "actorRole": actor_role,
                "targetUid": target_uid,
                "action": action,
                "ts": int(time.time() * 1000),
            }
        )
    except Exception:
        pass  # Auditing must never block the action itself.
    return result


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _password_gaps(password: str) -> list[str]:
    """Mirror lib/password-rules.ts — the same composition rules
    the public sign-up enforces, so an admin-created account is
    held to exactly the same standard."""
    gaps = []
    if len(password) < 10:
        gaps.append("at least 10 characters")
    if not re.search(r"[a-z]", password):
        gaps.append("a lowercase letter")
    if not re.search(r"[A-Z]", password):
        gaps.append("an uppercase letter")
    if not re.search(r"[^A-Za-z0-9\s]", password):
        gaps.append("a symbol such as ! @ # $ %")
    return gaps


def create_user_account(
    db,
    actor_uid: str,
    actor_role: str,
    email: str,
    password: str,
    display_name: str | None = None,
    email_verified: bool = True,
) -> dict:
    """Create a complete account from the admin panel.

    Any admin may create accounts (granting admin access stays
    owner-only, via patch_user's promote). The account is made
    in Firebase Auth with the admin-chosen temporary password,
    and its Firestore profile document is written server-side —
    the same shape the public sign-up route writes — so the
    person can sign in immediately and appears in the directory
    with a proper profile. Audited to adminActions."""
    email = (email or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise AdminAuthError(
            400, "INVALID_EMAIL", "Enter a valid email address."
        )
    if not isinstance(password, str):
        password = ""
    gaps = _password_gaps(password)
    if gaps:
        listing = (
            gaps[0]
            if len(gaps) == 1
            else ", ".join(gaps[:-1]) + " and " + gaps[-1]
        )
        raise AdminAuthError(
            400,
            "PASSWORD_RULES",
            f"The temporary password still needs {listing}.",
        )
    auth = firebase_auth()
    try:
        existing = auth.get_user_by_email(email)
    except Exception:
        existing = None
    if existing is not None:
        raise AdminAuthError(
            409,
            "EMAIL_EXISTS",
            "An account with that email already exists.",
        )
    name = (display_name or "").strip()[:80] or None
    try:
        record = auth.create_user(
            email=email,
            password=password,
            display_name=name,
            email_verified=bool(email_verified),
            disabled=False,
        )
    except AdminAuthError:
        raise
    except Exception:
        raise AdminAuthError(
            503,
            "CREATE_FAILED",
            "The account couldn't be created. Check the email and try again.",
        )
    uid = record.uid
    now_ms = int(time.time() * 1000)
    try:
        db.collection("users").document(uid).set(
            {
                "uid": uid,
                "email": email,
                "displayName": name or "",
                "photoURL": "",
                "createdAt": now_ms,
                "updatedAt": now_ms,
                "lastSignInAt": now_ms,
                "createdByAdmin": actor_uid,
            }
        )
    except Exception:
        pass  # The Auth account exists; the profile can heal on sign-in.
    try:
        db.collection("adminActions").add(
            {
                "actorUid": actor_uid,
                "actorRole": actor_role,
                "targetUid": uid,
                "action": "create",
                "ts": now_ms,
            }
        )
    except Exception:
        pass  # Auditing must never block the action itself.
    return {
        "success": True,
        "uid": uid,
        "email": email,
        "emailVerified": bool(email_verified),
        "action": "create",
    }


# ------------------------------------------------------------------
# Database explorer — the owner's master data access (2026-11-18).
#
# The owner asked for total visibility: every collection, every
# document, readable from the panel. This is deliberately
# READ-ONLY (mutations stay in the panel's controlled, audited
# action buttons — a raw document editor could corrupt live
# product data with one malformed field) and OWNER-ONLY (routes
# enforce the role; a plain admin never sees raw database
# contents). Reads are structurally capped so one huge document
# cannot blow up the response, and every full-document read is
# audited to adminActions like chat viewing is.
# ------------------------------------------------------------------

DATABASE_COLLECTIONS = [
    "users",
    "admins",
    "adminActions",
    "usageEvents",
    "searchEvents",
    "chatErrors",
    "safetyFlags",
    "deletedUsers",
    "deviceSignals",
    "chatJobs",
    "mediaBlobs",
    "mediaStats",
    "analytics_days",
    "analytics_minutes",
    "analytics_model_days",
    "analytics_model_minutes",
    "analytics_user_days",
]

_PATH_SEGMENT = re.compile(r"^[A-Za-z0-9_\-\:.@+]+$")


def _valid_db_path(path: str, want: str) -> list[str] | None:
    """Validate a Firestore path for the explorer. `want` is
    "collection" (odd segment count) or "document" (even).
    Returns the segments, or None for anything malformed."""
    if not isinstance(path, str) or not path or len(path) > 512:
        return None
    segments = path.split("/")
    if any(not _PATH_SEGMENT.match(segment) for segment in segments):
        return None
    if want == "collection" and len(segments) % 2 == 1:
        return segments
    if want == "document" and len(segments) % 2 == 0:
        return segments
    return None


def _json_safe(value, depth: int = 0):
    """Convert a Firestore value into JSON-safe data with
    structural caps: strings truncated, containers bounded,
    timestamps as ISO strings, references as paths."""
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value if len(value) <= 2000 else value[:2000] + "…[truncated]"
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat() if value.tzinfo else value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        return {"__bytes__": len(value)}
    if isinstance(value, dict):
        if depth >= 10:
            return {"__truncated__": "max depth"}
        out = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= 80:
                out["__truncated__"] = f"{len(value) - 80} more fields"
                break
            out[str(key)] = _json_safe(item, depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        if depth >= 10:
            return {"__truncated__": "max depth"}
        items = [_json_safe(item, depth + 1) for item in value[:50]]
        if len(value) > 50:
            items.append({"__truncated__": f"{len(value) - 50} more items"})
        return items
    # DocumentReference and GeoPoint are recognised structurally
    # so this module needs no google-cloud imports.
    path = getattr(value, "path", None)
    if isinstance(path, str) and hasattr(value, "id"):
        return {"__ref__": path}
    latitude = getattr(value, "latitude", None)
    longitude = getattr(value, "longitude", None)
    if isinstance(latitude, (int, float)) and isinstance(longitude, (int, float)):
        return {"__geo__": [latitude, longitude]}
    return str(value)


def _collection_ref(db, segments: list[str]):
    ref = db.collection(segments[0])
    index = 1
    while index < len(segments):
        ref = ref.document(segments[index]).collection(segments[index + 1])
        index += 2
    return ref


def _document_ref(db, segments: list[str]):
    ref = db.collection(segments[0]).document(segments[1])
    index = 2
    while index < len(segments):
        ref = ref.collection(segments[index]).document(segments[index + 1])
        index += 2
    return ref


def database_collections(db) -> dict:
    """The curated top-level collections with document counts.
    Each count is fault-isolated: a collection that cannot be
    counted reports null instead of failing the whole list."""
    collections = []
    for name in DATABASE_COLLECTIONS:
        count = None
        try:
            result = db.collection(name).count().get()
            count = int(result[0][0].value)
        except Exception:
            count = None
        collections.append({"name": name, "count": count})
    return {"collections": collections}


def database_documents(db, path: str, limit: int, start_after: str = "") -> dict:
    """One page of documents in a collection path. Each entry
    carries a compact preview (scalar fields, short strings);
    the full document is one more click away."""
    segments = _valid_db_path(path, "collection")
    if segments is None:
        raise AdminAuthError(400, "INVALID_PATH", "That collection path isn’t valid.")
    limit = max(1, min(int(limit or 25), 50))
    collection = _collection_ref(db, segments)
    query = collection.limit(limit + 1)
    if start_after:
        try:
            cursor = collection.document(start_after).get()
            if cursor.exists and hasattr(query, "start_after"):
                query = collection.start_after(cursor).limit(limit + 1)
        except Exception:
            pass
    docs = []
    has_more = False
    for snap in query.get():
        if len(docs) >= limit:
            has_more = True
            break
        data = snap.to_dict() or {}
        preview = {}
        for key, value in data.items():
            if isinstance(value, (str, int, float, bool)) or value is None:
                preview[key] = (
                    value[:120] + "…" if isinstance(value, str) and len(value) > 120 else value
                )
            if len(preview) >= 8:
                break
        docs.append({"id": snap.id, "preview": preview, "fieldCount": len(data)})
    return {
        "path": path,
        "documents": docs,
        "hasMore": has_more,
        "nextStartAfter": docs[-1]["id"] if has_more and docs else "",
    }


def database_document(db, path: str, actor_uid: str, actor_role: str) -> dict:
    """One full document (JSON-safe, capped) plus the names of
    its subcollections, so the owner can drill down anywhere.
    The read is audited — master access stays accountable."""
    segments = _valid_db_path(path, "document")
    if segments is None:
        raise AdminAuthError(400, "INVALID_PATH", "That document path isn’t valid.")
    ref = _document_ref(db, segments)
    snap = ref.get()
    if not snap.exists:
        raise AdminAuthError(404, "DOCUMENT_NOT_FOUND", "That document doesn’t exist.")
    subcollections = []
    try:
        subcollections = [child.id for child in ref.collections()]
    except Exception:
        subcollections = []
    try:
        db.collection("adminActions").add(
            {
                "action": "database_view",
                "actorUid": actor_uid,
                "actorRole": actor_role,
                "path": path,
                "ts": int(time.time() * 1000),
            }
        )
    except Exception:
        pass
    return {
        "path": path,
        "id": segments[-1],
        "data": _json_safe(snap.to_dict() or {}),
        "subcollections": subcollections,
    }

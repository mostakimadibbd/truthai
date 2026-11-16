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
import hmac
import time
from datetime import datetime, timedelta, timezone

from .auth import (
    check_service_token,
    decode_unverified_claims,
    verify_id_token_detailed,
    verify_id_token_public,
)
from .config import settings
from .firebase import firebase_app

BOOTSTRAP_ADMIN_EMAILS = ["mostakimbdyt@gmail.com"]

TOTAL_FIELDS = (
    "requests", "chatRequests", "apiRequests", "imageRequests",
    "promptTokens", "completionTokens", "totalTokens", "costUsd",
)

# Per-IP failed-auth throttle (in-memory; per instance, which is
# the same durability model as the job registry).
_failures: dict[str, list[float]] = {}
_FAILURE_LIMIT = 30
_FAILURE_WINDOW = 60.0


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
    now = time.time()
    recent = [t for t in _failures.get(ip, []) if now - t < _FAILURE_WINDOW]
    _failures[ip] = recent
    return len(recent) >= _FAILURE_LIMIT


def _record_failure(ip: str) -> None:
    _failures.setdefault(ip, []).append(time.time())


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


def get_overview(db) -> dict:
    now = datetime.now(timezone.utc)
    today = _day_key(now)

    totals_doc = db.collection("analytics_days").document(today).get()
    totals = _totals(totals_doc.to_dict() if totals_doc.exists else None)

    minutes = []
    for offset in range(59, -1, -1):
        key = _minute_key(now - timedelta(minutes=offset))
        doc = db.collection("analytics_minutes").document(key).get()
        minutes.append(
            {"minute": key, **_totals(doc.to_dict() if doc.exists else None)}
        )

    models = []
    for doc in db.collection("analytics_model_days").where("day", "==", today).get():
        data = doc.to_dict() or {}
        models.append(
            {"model": data.get("model") or "unknown", **_totals(data)}
        )
    models.sort(key=lambda row: row["totalTokens"], reverse=True)

    user_days = []
    for doc in db.collection("analytics_user_days").where("day", "==", today).get():
        data = doc.to_dict() or {}
        uid = data.get("uid") if isinstance(data.get("uid"), str) else doc.id
        user_days.append({"uid": uid, **_totals(data)})
    user_days.sort(key=lambda row: row["totalTokens"], reverse=True)
    top_users = user_days[:10]

    events = []
    event_docs = (
        db.collection("usageEvents")
        .order_by("ts", direction="DESCENDING")
        .limit(50)
        .get()
    )
    for doc in event_docs:
        data = doc.to_dict() or {}
        events.append(
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

    emails = _resolve_emails(
        list({*[row["uid"] for row in top_users], *[row["uid"] for row in events]})
    )
    for row in top_users:
        row["email"] = emails.get(row["uid"])
    for row in events:
        row["email"] = emails.get(row["uid"])

    searches = []
    for doc in (
        db.collection("searchEvents")
        .order_by("ts", direction="DESCENDING")
        .limit(20)
        .get()
    ):
        data = doc.to_dict() or {}
        searches.append(
            {
                "query": data.get("query") or "",
                "trigger": data.get("trigger") or "",
                "provider": data.get("provider"),
                "resultCount": data.get("resultCount") or 0,
                "ts": data.get("ts") or 0,
            }
        )

    errors = []
    for doc in (
        db.collection("chatErrors")
        .order_by("ts", direction="DESCENDING")
        .limit(20)
        .get()
    ):
        data = doc.to_dict() or {}
        errors.append(
            {
                "status": data.get("status"),
                "model": data.get("model"),
                "webInjected": data.get("webInjected") is True,
                "error": (data.get("error") or "")[:240] or None,
                "ts": data.get("ts") or 0,
            }
        )

    yesterday_doc = (
        db.collection("analytics_days")
        .document(_day_key(now - timedelta(days=1)))
        .get()
    )
    yesterday = _totals(yesterday_doc.to_dict() if yesterday_doc.exists else None)

    week = []
    for offset in range(6, -1, -1):
        day = _day_key(now - timedelta(days=offset))
        doc = db.collection("analytics_days").document(day).get()
        week.append(
            {"day": day, **_totals(doc.to_dict() if doc.exists else None)}
        )

    from . import watermark

    checks = settings.health()
    backend = {
        "executionMode": settings.execution_mode,
        "watermarkEngine": "c" if watermark.using_c_core() else "python",
        "integrations": checks,
        "integrationsOk": all(checks.values()),
    }
    # Lifetime: every day of metering, summed.
    lifetime = _totals(None)
    days_with_data = 0
    for doc in db.collection("analytics_days").limit(1000).get():
        data = doc.to_dict() or {}
        days_with_data += 1
        for field in TOTAL_FIELDS:
            value = data.get(field)
            if isinstance(value, (int, float)):
                lifetime[field] += value

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
        "ranges": _ranges(db, now),
    }


def _ranges(db, now: datetime) -> dict:
    """24h / 48h / 7d views. The 24h and 48h views aggregate
    the per-minute rollups into hourly (24h) and two-hourly
    (48h) buckets; 7d reuses the daily rollups. Best effort:
    a range that fails to load is simply absent."""
    ranges: dict = {}
    try:
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


def get_storage() -> dict:
    """Media storage from Cloudinary's usage API: plan,
    credits, storage/bandwidth consumption and object counts.
    Reports configured: false (with the variable names to set)
    until the backend can see the Cloudinary credentials."""
    credentials = settings.cloudinary_credentials
    if credentials is None:
        return {"configured": False}
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


def get_users(db, viewer_uid: str, viewer_role: str) -> dict:
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

    users = []
    page = auth.list_users(max_results=200)
    for record in page.iterate_all():
        profile = profiles.get(record.uid) or {}
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
        if len(users) >= 200:
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
        "viewer": {
            "uid": viewer_uid,
            "role": viewer_role,
            # False when the viewer is in through the bootstrap
            # owner path and has not claimed a registry entry yet.
            "registered": viewer_uid in registry,
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


def patch_user(
    db,
    actor_uid: str,
    actor_role: str,
    actor_email: str | None,
    target_uid: str,
    action: str,
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
    if action in ("reset-link", "sign-out-all"):
        # Full-control actions. Touching the OWNER's account
        # this way stays the owner's own power.
        if target_role == "owner" and actor_role != "owner":
            raise AdminAuthError(
                403,
                "OWNER_ONLY",
                "Only the owner can do that on the owner’s account.",
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
        if target_role == "owner" and actor_role != "owner":
            raise AdminAuthError(
                403, "OWNER_ONLY", "Only the owner can disable the owner’s account."
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

"""Admin API for the separate Xyro admin panel.

The panel is a standalone app (its own deployment, linked from
nowhere in the product). It talks to these endpoints through its
own server, which attaches three credentials to every call:

  1. X-Service-Token — the shared backend service token.
  2. X-Admin-Secret — a second secret that exists only on this
     service and the panel, so the main app's credentials alone
     can never open an admin endpoint.
  3. Authorization: Bearer <Firebase ID token> of the signed-in
     administrator, verified here, whose profile document must
     carry admin: true (the email allowlist is kept only as a
     bootstrap/recovery path for the owner).

Knowing this service's address alone therefore yields nothing:
every admin route fails closed without all three. Failed
attempts are throttled per client IP. Admin authority itself
lives in the database (users/{uid}.admin) — profile documents
are writable only by servers, so nobody can self-promote.
"""
from __future__ import annotations

import asyncio
import hmac
import time
from datetime import datetime, timedelta, timezone

from .auth import check_service_token, verify_id_token
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


async def authenticate_admin(
    service_token: str | None,
    admin_secret: str | None,
    authorization: str | None,
    client_ip: str,
    db,
) -> tuple[str, str | None]:
    """Verify all three credentials; return (uid, email)."""
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
    uid = verify_id_token(bearer)
    if not uid:
        raise fail(401, "UNAUTHORIZED", "A valid admin sign-in is required.")
    try:
        record = await asyncio.to_thread(firebase_auth().get_user, uid)
        email = record.email
    except Exception:
        email = None
    if _is_admin_email(email):
        return uid, email
    try:
        snapshot = await asyncio.to_thread(
            db.collection("users").document(uid).get
        )
        data = snapshot.to_dict() if snapshot.exists else None
    except Exception:
        data = None
    if data and data.get("admin") is True:
        return uid, email
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

    from . import watermark

    checks = settings.health()
    backend = {
        "executionMode": settings.execution_mode,
        "watermarkEngine": "c" if watermark.using_c_core() else "python",
        "integrations": checks,
        "integrationsOk": all(checks.values()),
    }
    return {
        "today": today,
        "totals": totals,
        "minutes": minutes,
        "models": models,
        "topUsers": top_users,
        "recentEvents": events,
        "recentSearches": searches,
        "recentErrors": errors,
        "backend": backend,
    }


def get_users(db) -> dict:
    now = datetime.now(timezone.utc)
    today = _day_key(now)
    auth = firebase_auth()

    profiles: dict[str, dict] = {}
    for doc in db.collection("users").limit(500).get():
        profiles[doc.id] = doc.to_dict() or {}

    usage: dict[str, dict] = {}
    for doc in db.collection("analytics_user_days").where("day", "==", today).get():
        data = doc.to_dict() or {}
        uid = data.get("uid") if isinstance(data.get("uid"), str) else doc.id
        usage[uid] = _totals(data)

    users = []
    page = auth.list_users(max_results=200)
    for record in page.iterate_all():
        profile = profiles.get(record.uid) or {}
        totals = usage.get(record.uid) or _totals(None)
        metadata = record.user_metadata
        users.append(
            {
                "uid": record.uid,
                "email": record.email,
                "displayName": record.display_name
                or (profile.get("displayName") if isinstance(profile.get("displayName"), str) else None),
                "emailVerified": bool(record.email_verified),
                "disabled": bool(record.disabled),
                "admin": profile.get("admin") is True,
                "createdAt": getattr(metadata, "creation_timestamp", None),
                "lastSignInAt": getattr(metadata, "last_sign_in_timestamp", None),
                "requestsToday": totals["requests"],
                "totalTokensToday": totals["totalTokens"],
                "costUsdToday": totals["costUsd"],
            }
        )
        if len(users) >= 200:
            break
    users.sort(
        key=lambda row: (not row["admin"], -row["totalTokensToday"])
    )
    return {"today": today, "users": users, "truncated": page.page_token is not None}


ACTIONS = ("promote", "demote", "disable", "enable")


def patch_user(db, actor_uid: str, target_uid: str, action: str) -> dict:
    if action not in ACTIONS:
        raise AdminAuthError(400, "INVALID_ACTION", "A valid action is required.")
    if target_uid == actor_uid and action in ("demote", "disable"):
        raise AdminAuthError(
            400,
            "SELF_ACTION",
            "You can’t demote or disable your own admin account.",
        )
    if action in ("promote", "demote"):
        db.collection("users").document(target_uid).set(
            {"admin": action == "promote"}, merge=True
        )
    else:
        firebase_auth().update_user(target_uid, disabled=(action == "disable"))
    try:
        db.collection("adminActions").add(
            {
                "actorUid": actor_uid,
                "targetUid": target_uid,
                "action": action,
                "ts": int(time.time() * 1000),
            }
        )
    except Exception:
        pass  # Auditing must never block the action itself.
    return {"success": True, "uid": target_uid, "action": action}

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
    }


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
        "truncated": page.page_token is not None,
        "viewer": {
            "uid": viewer_uid,
            "role": viewer_role,
            # False when the viewer is in through the bootstrap
            # owner path and has not claimed a registry entry yet.
            "registered": viewer_uid in registry,
        },
    }


ACTIONS = ("promote", "demote", "disable", "enable", "delete")


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
    if action in ("promote", "demote"):
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
    return {"success": True, "uid": target_uid, "action": action}

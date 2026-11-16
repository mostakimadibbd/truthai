"""Request authentication — the same rules as the Next.js app.

A job submission must carry ALL of:
  1. the shared service token (proves the caller is our own Next.js
     proxy, not the public internet) — compared in constant time;
  2. the user's `__Host-xyro_session` cookie: an HS256 JWT signed
     with SESSION_SECRET whose subject is the uid and whose `sid`
     claim is not revoked in Upstash Redis (`revoked:{sid}`);
  3. a Firebase ID token in the Authorization header whose uid
     matches the session's uid.

The service never trusts the proxy's word for who the user is; it
re-verifies the user's own credentials on every call.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import time

import httpx
import jwt

from .config import settings

SESSION_COOKIE_NAME = "__Host-xyro_session"


def check_service_token(provided: str | None) -> bool:
    if not settings.service_token or not provided:
        return False
    return hmac.compare_digest(provided, settings.service_token)


async def _session_revoked(sid: str) -> bool:
    if not (settings.upstash_rest_url and settings.upstash_rest_token):
        return False
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            response = await client.post(
                f"{settings.upstash_rest_url}/get/{_revocation_key(sid)}",
                headers={"Authorization": f"Bearer {settings.upstash_rest_token}"},
            )
            response.raise_for_status()
            return response.json().get("result") is not None
    except Exception:
        # Revocation store unreachable: mirror the TS behaviour of
        # the session layer — the JWT's own expiry still bounds the
        # session, and other guards remain in force.
        return False


def _revocation_key(sid: str) -> str:
    return f"revoked:{sid}"


def verify_session_cookie(cookie_value: str | None) -> dict | None:
    if not cookie_value or not settings.session_secret:
        return None
    try:
        claims = jwt.decode(
            cookie_value,
            settings.session_secret,
            algorithms=["HS256"],
            options={"require": ["exp", "sub"]},
        )
    except jwt.PyJWTError:
        return None
    uid = claims.get("sub")
    sid = claims.get("sid")
    if not isinstance(uid, str) or not isinstance(sid, str):
        return None
    # The TS session layer also enforces an absolute expiry
    # (absExp, ms epoch) beyond the sliding exp claim.
    import time

    abs_exp = claims.get("absExp")
    if isinstance(abs_exp, (int, float)) and time.time() * 1000 > abs_exp:
        return None
    return {"uid": uid, "sid": sid}


def verify_id_token(id_token: str | None) -> str | None:
    uid, _reason = verify_id_token_detailed(id_token)
    return uid


def decode_unverified_claims(id_token: str | None) -> dict:
    """Read a JWT's payload WITHOUT trusting it — used only to
    explain a verification failure (which project issued the
    token), never to authorize anything."""
    if not id_token or id_token.count(".") != 2:
        return {}
    try:
        import base64
        import json

        payload = id_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload.encode()))
        return claims if isinstance(claims, dict) else {}
    except Exception:
        return {}


_CERTS_URL = (
    "https://www.googleapis.com/robot/v1/metadata/x509/"
    "securetoken@system.gserviceaccount.com"
)
_certs_cache: dict = {"certs": {}, "expires": 0.0}


def _google_certs() -> dict:
    """Google's public ID-token signing certificates, cached
    per their Cache-Control header."""
    now = time.time()
    if _certs_cache["certs"] and now < _certs_cache["expires"]:
        return _certs_cache["certs"]
    response = httpx.get(_CERTS_URL, timeout=10)
    response.raise_for_status()
    certs = response.json()
    max_age = 3600
    match = re.search(r"max-age=(\d+)", response.headers.get("cache-control", ""))
    if match:
        max_age = int(match.group(1))
    _certs_cache.update(certs=certs, expires=now + max_age)
    return certs


def verify_id_token_public(
    id_token: str | None,
) -> tuple[str | None, str | None, str | None]:
    """(uid, email, failure) — verify a Firebase ID token
    against Google's PUBLIC signing keys, the same algorithm
    the Admin SDK uses, needing only the project id. This is
    the fallback that keeps admin sign-in working even when
    the service-account credential itself is damaged: a broken
    private key must never lock the owner out."""
    project = settings.firebase_project
    if not id_token or not project:
        return None, None, "MissingTokenOrProject"
    try:
        kid = jwt.get_unverified_header(id_token).get("kid")
        pem = _google_certs().get(kid)
        if not pem:
            _certs_cache["expires"] = 0.0  # keys may have rotated
            pem = _google_certs().get(kid)
        if not pem:
            return None, None, "UnknownSigningKey"
        from cryptography.x509 import load_pem_x509_certificate

        public_key = load_pem_x509_certificate(pem.encode()).public_key()
        claims = jwt.decode(
            id_token,
            public_key,
            algorithms=["RS256"],
            audience=project,
            issuer=f"https://securetoken.google.com/{project}",
        )
        uid = claims.get("sub")
        email = claims.get("email")
        return (
            uid if isinstance(uid, str) else None,
            email if isinstance(email, str) else None,
            None,
        )
    except Exception as error:  # noqa: BLE001 - class name is the diagnostic
        return None, None, type(error).__name__


def verify_id_token_detailed(id_token: str | None) -> tuple[str | None, str | None]:
    """(uid, failure) — failure is the exception class name when
    verification rejects the token, so an admin-facing error can
    say WHY (expired, wrong project, broken credentials…)."""
    if not id_token:
        return None, "MissingToken"
    try:
        from firebase_admin import auth as firebase_auth

        from .firebase import firebase_app

        firebase_app()
        decoded = firebase_auth.verify_id_token(id_token)
        uid = decoded.get("uid")
        return (uid if isinstance(uid, str) else None), None
    except Exception as error:  # noqa: BLE001 - the class name is the diagnostic
        return None, type(error).__name__


async def authenticate(
    service_token: str | None,
    cookie_header: str | None,
    authorization: str | None,
) -> dict | None:
    """Return {"uid", "sid"} when every check passes, else None."""
    if not check_service_token(service_token):
        return None
    session_cookie = _cookie_value(cookie_header, SESSION_COOKIE_NAME)
    session = verify_session_cookie(session_cookie)
    if session is None:
        return None
    if await _session_revoked(session["sid"]):
        return None
    bearer = None
    if authorization and authorization.startswith("Bearer "):
        bearer = authorization[len("Bearer "):].strip()
    token_uid = verify_id_token(bearer)
    if token_uid is None or token_uid != session["uid"]:
        return None
    return session


def _cookie_value(cookie_header: str | None, name: str) -> str | None:
    if not cookie_header:
        return None
    for part in cookie_header.split(";"):
        if "=" in part:
            key, value = part.split("=", 1)
            if key.strip() == name:
                return value.strip()
    return None


def hash_key_part(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:32]

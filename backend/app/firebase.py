"""Firebase Admin initialisation (Firestore + Realtime Database).

Uses the same service account as the Next.js app's firebase-admin
setup, supplied either as a JSON document in
FIREBASE_SERVICE_ACCOUNT_JSON or as the split
FIREBASE_ADMIN_PROJECT_ID / _CLIENT_EMAIL / _PRIVATE_KEY trio.
Initialised lazily so unit tests and /health can run without it.

Dashboard pastes mangle private keys in predictable ways —
literal \\n escapes instead of newlines, surrounding quotes,
Windows line endings, or a lost PEM header/footer. The loader
below generates the plausible repairs and uses the first one
that actually parses as an RSA private key, so a formatting
slip in a settings page can't take the service down. A key
whose base64 body itself is wrong still fails, honestly.
"""
from __future__ import annotations

import json
import re

from .config import settings

_app = None

_PEM_HEADER = "-----BEGIN PRIVATE KEY-----"
_PEM_FOOTER = "-----END PRIVATE KEY-----"


def _key_candidates(raw: str) -> list[str]:
    """Plausible repairs of a pasted private key, most likely
    first, deduplicated."""
    candidates: list[str] = []

    def add(value: str) -> None:
        value = value.strip().strip('"').strip("'").strip()
        if value and value not in candidates:
            candidates.append(value)

    base = raw.strip().strip('"').strip("'").strip()
    add(base)
    add(base.replace("\\n", "\n").replace("\\r", "\r"))
    add(base.replace("\r\n", "\n"))
    # Bare base64 body with the PEM frame lost: re-wrap it.
    body = re.sub(r"-----[A-Z ]+-----", "", base)
    body = re.sub(r"[^A-Za-z0-9+/=]", "", body.replace("\\n", ""))
    if len(body) > 100:
        lines = "\n".join(body[i : i + 64] for i in range(0, len(body), 64))
        add(f"{_PEM_HEADER}\n{lines}\n{_PEM_FOOTER}\n")
    # Frame present but lines collapsed: re-wrap the body.
    if _PEM_HEADER in base:
        inner = re.sub(r"-----[A-Z ]+-----", "", base)
        inner = re.sub(r"[^A-Za-z0-9+/=]", "", inner.replace("\\n", ""))
        if len(inner) > 100:
            lines = "\n".join(
                inner[i : i + 64] for i in range(0, len(inner), 64)
            )
            add(f"{_PEM_HEADER}\n{lines}\n{_PEM_FOOTER}\n")
    return candidates


def _key_parses(pem: str) -> bool:
    try:
        from cryptography.hazmat.primitives.serialization import (
            load_pem_private_key,
        )

        load_pem_private_key(pem.encode(), password=None)
        return True
    except Exception:
        return False


def _working_info() -> dict:
    """Service-account info whose private key provably parses."""
    raw = settings.firebase_service_account_json
    if raw:
        info = json.loads(raw)
    elif (
        settings.firebase_project_id
        and settings.firebase_client_email
        and settings.firebase_private_key
    ):
        info = {
            "type": "service_account",
            "project_id": settings.firebase_project_id,
            "private_key": settings.firebase_private_key,
            "client_email": settings.firebase_client_email,
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    else:
        raise RuntimeError(
            "Set FIREBASE_SERVICE_ACCOUNT_JSON or the "
            "FIREBASE_ADMIN_PROJECT_ID / _CLIENT_EMAIL / _PRIVATE_KEY trio"
        )
    key = info.get("private_key")
    if not isinstance(key, str) or not key:
        raise ValueError("Service account private_key is missing.")
    for candidate in _key_candidates(key):
        if _key_parses(candidate):
            info["private_key"] = candidate
            return info
    raise ValueError(
        "Service account private_key could not be parsed in any form."
    )


def firebase_app():
    global _app
    if _app is not None:
        return _app
    import firebase_admin
    from firebase_admin import credentials

    info = _working_info()
    cert = credentials.Certificate(info)
    options = {}
    if settings.firebase_database_url:
        options["databaseURL"] = settings.firebase_database_url
    _app = firebase_admin.initialize_app(cert, options)
    return _app


_firestore_client = None


def firestore_client():
    """The Firestore client is cached: building one spins up a
    gRPC channel, which is far too expensive to pay per job."""
    global _firestore_client
    if _firestore_client is None:
        from firebase_admin import firestore

        firebase_app()
        _firestore_client = firestore.client()
    return _firestore_client


def rtdb_ref(path: str):
    from firebase_admin import db as rtdb

    firebase_app()
    return rtdb.reference(path)

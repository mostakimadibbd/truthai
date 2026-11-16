"""Firebase Admin initialisation (Firestore + Realtime Database).

Uses the same service account as the Next.js app's firebase-admin
setup, supplied as a JSON document in FIREBASE_SERVICE_ACCOUNT_JSON.
Initialised lazily so unit tests and /health can run without it.
"""
from __future__ import annotations

import json

from .config import settings

_app = None


def firebase_app():
    global _app
    if _app is not None:
        return _app
    import firebase_admin
    from firebase_admin import credentials

    raw = settings.firebase_service_account_json
    if raw:
        info = json.loads(raw)
    elif (
        settings.firebase_project_id
        and settings.firebase_client_email
        and settings.firebase_private_key
    ):
        # Split form (same variables as the Next.js app). Vercel
        # stores the key with literal \n escapes; restore them.
        info = {
            "type": "service_account",
            "project_id": settings.firebase_project_id,
            "private_key": settings.firebase_private_key.replace("\\n", "\n"),
            "client_email": settings.firebase_client_email,
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    else:
        raise RuntimeError(
            "Set FIREBASE_SERVICE_ACCOUNT_JSON or the "
            "FIREBASE_ADMIN_PROJECT_ID / _CLIENT_EMAIL / _PRIVATE_KEY trio"
        )
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

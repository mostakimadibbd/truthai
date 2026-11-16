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
    if not raw:
        raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_JSON is not set")
    cert = credentials.Certificate(json.loads(raw))
    options = {}
    if settings.firebase_database_url:
        options["databaseURL"] = settings.firebase_database_url
    _app = firebase_admin.initialize_app(cert, options)
    return _app


def firestore_client():
    from firebase_admin import firestore

    firebase_app()
    return firestore.client()


def rtdb_ref(path: str):
    from firebase_admin import db as rtdb

    firebase_app()
    return rtdb.reference(path)

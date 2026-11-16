"""Environment configuration for the Xyro AI backend service.

Every value mirrors an env var the Next.js app already uses, so a
deployment sets the same secrets in both places. The service
refuses to serve job traffic until the essentials are present;
`/health` reports which integrations are configured (booleans
only, never values).
"""
from __future__ import annotations

import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


class Settings:
    # Shared with the Next.js app
    session_secret: str = os.environ.get("SESSION_SECRET", "")
    openrouter_api_key: str = os.environ.get("OPENROUTER_API_KEY", "")
    firebase_service_account_json: str = os.environ.get(
        "FIREBASE_SERVICE_ACCOUNT_JSON", ""
    )
    firebase_database_url: str = os.environ.get(
        "NEXT_PUBLIC_FIREBASE_DATABASE_URL", ""
    ) or os.environ.get("FIREBASE_DATABASE_URL", "")
    upstash_rest_url: str = os.environ.get("UPSTASH_REDIS_REST_URL", "")
    upstash_rest_token: str = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "")

    # Backend-only
    service_token: str = os.environ.get("BACKEND_SERVICE_TOKEN", "")
    openrouter_base_url: str = os.environ.get(
        "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
    ).rstrip("/")
    max_concurrent_upstream: int = _int("BACKEND_MAX_CONCURRENT_UPSTREAM", 8)
    job_timeout_seconds: int = _int("BACKEND_JOB_TIMEOUT_SECONDS", 280)

    def health(self) -> dict[str, bool]:
        return {
            "session": bool(self.session_secret),
            "openRouter": bool(self.openrouter_api_key),
            "firebaseAdmin": bool(self.firebase_service_account_json),
            "realtimeDatabase": bool(self.firebase_database_url),
            "redis": bool(self.upstash_rest_url and self.upstash_rest_token),
            "serviceToken": bool(self.service_token),
        }

    def ready_for_jobs(self) -> bool:
        checks = self.health()
        return all(
            checks[key]
            for key in ("session", "openRouter", "firebaseAdmin", "serviceToken")
        )


settings = Settings()

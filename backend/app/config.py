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
    # Split form, identical to the Next.js app's variables, so a
    # deployment can copy the same three values across instead of
    # handling a JSON document.
    firebase_project_id: str = os.environ.get("FIREBASE_ADMIN_PROJECT_ID", "")
    firebase_client_email: str = os.environ.get("FIREBASE_ADMIN_CLIENT_EMAIL", "")
    firebase_private_key: str = os.environ.get("FIREBASE_ADMIN_PRIVATE_KEY", "")
    firebase_database_url: str = os.environ.get(
        "NEXT_PUBLIC_FIREBASE_DATABASE_URL", ""
    ) or os.environ.get("FIREBASE_DATABASE_URL", "")
    upstash_rest_url: str = os.environ.get("UPSTASH_REDIS_REST_URL", "")
    upstash_rest_token: str = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "")

    # Backend-only
    service_token: str = os.environ.get("BACKEND_SERVICE_TOKEN", "")
    # Admin API (used only by the separate admin panel): a second,
    # independent secret so the main app's service token alone can
    # never open the admin endpoints. Fail-closed when unset.
    admin_api_secret: str = os.environ.get("ADMIN_API_SECRET", "")
    admin_emails: str = os.environ.get("ADMIN_EMAILS", "")
    # Execution mode: "async" (default) returns 202 and runs the
    # job in-process — the mode that survives anything, on a
    # persistent host. "sync" executes the job inside the submit
    # request: required on serverless hosts (Vercel), where
    # background work is frozen once the response is sent. Vercel
    # sets VERCEL=1 itself, so deploying there just works;
    # BACKEND_EXECUTION_MODE overrides either way.
    execution_mode: str = os.environ.get("BACKEND_EXECUTION_MODE", "") or (
        "sync" if os.environ.get("VERCEL") else "async"
    )
    openrouter_base_url: str = os.environ.get(
        "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
    ).rstrip("/")
    max_concurrent_upstream: int = _int("BACKEND_MAX_CONCURRENT_UPSTREAM", 8)
    job_timeout_seconds: int = _int("BACKEND_JOB_TIMEOUT_SECONDS", 280)

    @property
    def firebase_project(self) -> str | None:
        """The Firebase project the Admin credentials belong to
        (a public identifier, safe to surface in diagnostics)."""
        if self.firebase_service_account_json:
            try:
                import json

                parsed = json.loads(self.firebase_service_account_json)
                project = parsed.get("project_id")
                if isinstance(project, str) and project:
                    return project
            except Exception:
                pass
        return self.firebase_project_id or None

    def health(self) -> dict[str, bool]:
        return {
            "session": bool(self.session_secret),
            "openRouter": bool(self.openrouter_api_key),
            "firebaseAdmin": bool(self.firebase_service_account_json)
            or bool(
                self.firebase_project_id
                and self.firebase_client_email
                and self.firebase_private_key
            ),
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

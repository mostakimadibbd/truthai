"""Xyro AI backend service (Python + C).

A persistent, job-based execution service that sits behind the
Next.js app:

  * POST /v1/chat/jobs — accepts a chat turn and returns at once
    with a job id. The turn then runs to completion inside this
    service and is saved to Firestore no matter what happens to
    the caller's connection — closing the tab cannot kill a reply.
  * GET /v1/chat/jobs/{id} — job status for the Next.js proxy.
  * GET /v1/models — the free-model catalogue (same rules as web).
  * POST /v1/images/watermark — embed/extract the invisible image
    watermark through the C core (app/watermark.py).
  * GET /health — integration booleans, mirroring /api/health.

Run with a single uvicorn worker: jobs are asyncio tasks in one
process (I/O-bound work scales without extra processes), and the
in-process registry is what status polling reads.
"""
from __future__ import annotations

import base64
import io

from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse

from . import admin, auth, jobs, logstream, models as model_lib, openrouter as openrouter_lib, security, watermark
from .config import app_public_url, settings
from .firebase import firestore_client

app = FastAPI(title="Xyro AI Backend", docs_url=None, redoc_url=None)


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"success": False, "error": {"code": code, "message": message}},
    )


# Paths whose own traffic would flood the log stream with
# itself: health probes and the panel's live-log polling.
_LOG_SKIP_PATHS = ("/health", "/v1/admin/live-logs")


@app.middleware("http")
async def logging_middleware(request: Request, call_next):
    """One structured entry per request into the realtime log
    stream (app/logstream.py — Redis-backed, zero Firestore
    reads), mirrored to stdout for Vercel's own log view."""
    import time as _time

    started = _time.time()
    response = await call_next(request)
    path = request.url.path
    if not any(path.startswith(skip) for skip in _LOG_SKIP_PATHS):
        status = response.status_code
        level = "error" if status >= 500 else "warn" if status >= 400 else "info"
        elapsed_ms = int((_time.time() - started) * 1000)
        logstream.emit(
            "xyro-backend",
            level,
            f"{request.method} {path} → {status} · {elapsed_ms}ms",
        )
    return response


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (
        request.client.host if request.client else "unknown"
    )


def _apply_security_headers(response, path: str):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Strict-Transport-Security"] = (
        "max-age=31536000; includeSubDomains"
    )
    if path.startswith("/v1/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    """Hardening + bot protection for every request (app/security.py).

    Callers presenting the service token (the main app, the admin
    panel) are trusted server-to-server traffic and are never
    challenged or blocked by heuristics — heuristics guard the
    unauthenticated surface: scanner probes are blocked, auth-
    failure and 404 floods flag the IP, and a flagged IP must
    complete a human verification (428 + challenge URL) before
    /v1/ calls are served again.
    """
    path = request.url.path
    ip = _client_ip(request)
    # Oversized bodies never reach a handler. The watermark route
    # carries base64 images, so it gets the generous cap.
    cap = 16 * 1024 * 1024 if path.startswith("/v1/images") else 2 * 1024 * 1024
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > cap:
                return _apply_security_headers(
                    _error(413, "PAYLOAD_TOO_LARGE", "That request is too large."),
                    path,
                )
        except ValueError:
            pass
    trusted = auth.check_service_token(request.headers.get("x-service-token"))
    if not trusted:
        if security.rate_limited(ip):
            return _apply_security_headers(
                _error(
                    429,
                    "RATE_LIMITED",
                    "Too many requests — slow down and try again shortly.",
                ),
                path,
            )
        verdict = security.decision(ip, path)
        if verdict == "block":
            return _apply_security_headers(
                _error(
                    403,
                    "IP_BLOCKED",
                    "This address is temporarily blocked after suspicious "
                    "activity. If you are a real visitor, wait a few "
                    "minutes and try again.",
                ),
                path,
            )
        if (
            verdict == "challenge"
            and path.startswith("/v1/")
            and path != "/v1/bot/verify"
            and not security.check_pass(
                request.headers.get("x-human-pass"),
                ip,
                request.headers.get("user-agent"),
            )
        ):
            challenge = JSONResponse(
                status_code=428,
                content={
                    "success": False,
                    "error": {
                        "code": "BOT_VERIFICATION_REQUIRED",
                        "message": (
                            "We detected unusual activity from this "
                            "connection. Please complete a quick human "
                            "verification to continue."
                        ),
                    },
                    "challengeUrl": f"{app_public_url()}/bot-check",
                },
            )
            return _apply_security_headers(challenge, path)
    response = await call_next(request)
    if response.status_code == 404 and not trusted:
        security.record_not_found(ip)
    return _apply_security_headers(response, path)


@app.get("/health")
async def health(
    x_service_token: str | None = Header(default=None),
) -> dict:
    if not auth.check_service_token(x_service_token):
        # Public view: enough for an uptime check, nothing about
        # which integrations are configured or how the service
        # runs. The detailed view requires the service token —
        # this service's address and configuration are not public
        # information, and it is reachable only by the main app.
        return {"ok": True, "service": "xyro-backend"}
    checks = settings.health()
    # Beyond presence: prove the Firebase Admin credentials
    # actually initialize, and name the project they belong to
    # (a public identifier). This is what distinguishes "the
    # variables exist" from "sign-in verification will work".
    admin_ready = False
    admin_error = None
    admin_error_detail = None
    try:
        from .firebase import firebase_app

        firebase_app()
        admin_ready = True
    except Exception as error:  # noqa: BLE001 - class name is the diagnostic
        admin_error = type(error).__name__
        admin_error_detail = str(error)[:160]
    # Cloudflare Workers AI: presence is not proof — probe the
    # account's model list so a bad token or a wrong account id is
    # visible here instead of failing silently inside the chain.
    cloudflare_live = None
    cloudflare_error = None
    try:
        import httpx

        from .config import cloudflare_account_id, provider_api_key

        cf_token = provider_api_key(["CLOUDFLARE_API_TOKEN"])
        cf_account = cloudflare_account_id()
        if cf_token and cf_account:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.get(
                    f"https://api.cloudflare.com/client/v4/accounts/{cf_account}/ai/models/search",
                    headers={"Authorization": f"Bearer {cf_token}"},
                )
            cloudflare_live = resp.status_code == 200
            if not cloudflare_live:
                cloudflare_error = f"http_{resp.status_code}"
    except Exception as error:  # noqa: BLE001 - class name is the diagnostic
        cloudflare_live = False
        cloudflare_error = type(error).__name__
    # Live data-plane probes: initialising the Admin SDK is not
    # proof it can read — a deleted or revoked service-account
    # key still initialises. These make real (tiny) calls so a
    # dead credential is visible here instead of surfacing as a
    # generic panel failure.
    data_plane = None
    try:
        import asyncio

        data_plane = await asyncio.to_thread(
            admin.data_plane_status, firestore_client, admin.firebase_auth
        )
    except Exception as error:  # noqa: BLE001 - class name is the diagnostic
        data_plane = {"error": type(error).__name__}
    return {
        "ok": True,
        "service": "xyro-backend",
        "integrations": checks,
        "providers": openrouter_lib.provider_presence(),
        "cloudflareLive": cloudflare_live,
        "cloudflareError": cloudflare_error,
        "firebaseProject": settings.firebase_project,
        "adminReady": admin_ready,
        "adminError": admin_error,
        "adminErrorDetail": admin_error_detail,
        "dataPlane": data_plane,
        "watermarkEngine": "c" if watermark.using_c_core() else "python",
        "executionMode": settings.execution_mode,
    }


async def _authenticate(request: Request) -> dict | None:
    return await auth.authenticate(
        request.headers.get("x-service-token"),
        request.headers.get("cookie"),
        request.headers.get("authorization"),
        delegation=request.headers.get("x-delegation"),
    )


@app.get("/v1/models")
async def list_models(x_service_token: str | None = Header(default=None)):
    if not auth.check_service_token(x_service_token):
        return _error(401, "UNAUTHORIZED", "Invalid service token.")
    models = await model_lib.get_free_models()
    return {
        "success": True,
        "models": [{"id": m["id"], "name": m["name"]} for m in models],
        "auto": model_lib.AUTO_MODEL_ID,
    }


@app.post("/v1/chat/jobs")
async def submit_chat_job(request: Request):
    if not settings.ready_for_jobs():
        return _error(503, "BACKEND_NOT_CONFIGURED", "The backend service is not fully configured.")
    session = await _authenticate(request)
    if session is None:
        return _error(401, "UNAUTHORIZED", "Your session could not be verified.")
    try:
        body = await request.json()
    except Exception:
        return _error(400, "INVALID_JSON", "Send a JSON body.")
    if not isinstance(body, dict):
        return _error(400, "INVALID_BODY", "Send a JSON object.")

    chat_id = body.get("chatId")
    user_message_id = body.get("userMessageId")
    assistant_message_id = body.get("assistantMessageId")
    response_id = body.get("responseId")
    content = body.get("content")
    model = body.get("model")
    for value, limit in (
        (chat_id, 128),
        (user_message_id, 64),
        (assistant_message_id, 64),
        (response_id, 64),
    ):
        if not isinstance(value, str) or not value or len(value) > limit:
            return _error(400, "INVALID_REQUEST", "The request is missing required fields.")
    if not isinstance(content, str) or not content.strip() or len(content) > 12_000:
        return _error(400, "INVALID_CONTENT", "Message content is missing or too long.")
    if model is not None and (not isinstance(model, str) or len(model) > 200):
        return _error(400, "INVALID_MODEL", "Choose one of the free models from the model list.")

    # Image attachments (descriptors built server-side by the
    # Next.js route from verified upload records — never trusted
    # from the client directly; this is a second, structural
    # check). Only images delegate; documents stay on the TS
    # path, which owns text extraction.
    attachments: list[dict] = []
    raw_attachments = body.get("attachments")
    if raw_attachments is not None:
        if not isinstance(raw_attachments, list) or len(raw_attachments) > 10:
            return _error(400, "INVALID_ATTACHMENT", "Attachments are malformed.")
        for item in raw_attachments:
            if not isinstance(item, dict):
                return _error(400, "INVALID_ATTACHMENT", "Attachments are malformed.")
            descriptor = {
                "id": item.get("id"),
                "name": item.get("name"),
                "mimeType": item.get("mimeType"),
                "size": item.get("size"),
                "publicId": item.get("publicId"),
                "format": item.get("format"),
                "resourceType": item.get("resourceType"),
            }
            if (
                not isinstance(descriptor["id"], str)
                or not descriptor["id"]
                or not isinstance(descriptor["name"], str)
                or not isinstance(descriptor["mimeType"], str)
                or not descriptor["mimeType"].startswith("image/")
                or not isinstance(descriptor["size"], (int, float))
                or not isinstance(descriptor["publicId"], str)
                or not descriptor["publicId"]
                or descriptor["publicId"].startswith("blob:")
                or not isinstance(descriptor["format"], str)
                or descriptor["resourceType"] != "image"
            ):
                return _error(400, "INVALID_ATTACHMENT", "Only image attachments can be delegated.")
            attachments.append(descriptor)

    from .firebase import firestore_client, rtdb_ref

    submitted = jobs.submit_chat_job(
        {
            "uid": session["uid"],
            "chatId": chat_id,
            "userMessageId": user_message_id,
            "assistantMessageId": assistant_message_id,
            "responseId": response_id,
            "content": content,
            "model": model,
            "openRouterOnly": body.get("openRouterOnly") is True,
            "attachments": attachments,
        },
        firestore_client(),
        rtdb_ref,
    )
    if settings.execution_mode == "sync":
        # Serverless host (Vercel): background tasks are frozen
        # when the response is sent, so the job runs to completion
        # inside this request and the response carries the final
        # status. The caller's first status poll then resolves
        # immediately from the registry.
        final = await jobs.wait_for_job(
            submitted["jobId"], timeout=settings.job_timeout_seconds + 10
        )
        return {"success": True, "delegated": True, **(final or submitted)}
    return JSONResponse(
        status_code=202,
        content={"success": True, "delegated": True, **submitted},
    )


@app.get("/v1/chat/jobs/{job_id}")
async def chat_job_status(job_id: str, request: Request):
    session = await _authenticate(request)
    if session is None:
        return _error(401, "UNAUTHORIZED", "Your session could not be verified.")
    found = jobs.get_job(job_id, session["uid"])
    if found is None:
        return _error(404, "JOB_NOT_FOUND", "This job no longer exists.")
    return {"success": True, **found}


async def _admin_gate(request: Request):
    """Shared gate for the admin API: service token + admin
    secret + a verified administrator ID token (app/admin.py).
    Returns (uid, email, role) or a JSONResponse error."""
    forwarded = request.headers.get("x-forwarded-for", "")
    client_ip = (
        forwarded.split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )
    try:
        return await admin.authenticate_admin(
            request.headers.get("x-service-token"),
            request.headers.get("x-admin-secret"),
            request.headers.get("authorization"),
            client_ip,
            firestore_client,
        )
    except admin.AdminAuthError as error:
        if error.status in (401, 403):
            # Failed admin authentication feeds the bot-protection
            # scoring: bursts flag (then block) the source IP.
            security.record_auth_failure(client_ip)
        return _error(error.status, error.code, error.message)
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "Admin data couldn’t be loaded.")


# Short-TTL response cache for the panel's read endpoints.
# The panel polls these every few seconds; without a cache,
# every poll re-read the same rollups and event lists, and an
# evening of that exhausted Firestore's free daily read quota
# (ResourceExhausted — the panel then showed zeros/errors).
# The admin gate still runs on EVERY request; only the data
# build is cached, per process, for a few seconds.
_admin_cache: dict = {}


def _admin_cached(key: str, ttl_seconds: float, build):
    import copy
    import time

    now = time.time()
    hit = _admin_cache.get(key)
    if hit is not None and now - hit[0] < ttl_seconds:
        return copy.deepcopy(hit[1])
    value = build()
    _admin_cache[key] = (now, copy.deepcopy(value))
    return value


@app.get("/v1/admin/overview")
async def admin_overview(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    try:
        return {
            "success": True,
            **_admin_cached(
                "overview", 45.0, lambda: admin.get_overview(firestore_client())
            ),
        }
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "Admin data couldn’t be loaded.")


@app.get("/v1/admin/audit")
async def admin_audit(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    try:
        return {
            "success": True,
            **_admin_cached(
                "audit", 60.0, lambda: admin.get_audit(firestore_client())
            ),
        }
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "Admin data couldn’t be loaded.")


@app.get("/v1/admin/users")
async def admin_users(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    viewer_uid, _email, viewer_role = gate
    query = request.query_params.get("q") or ""
    try:
        if query:
            # Directory searches always read fresh.
            payload = admin.get_users(
                firestore_client(), viewer_uid, viewer_role, query
            )
        else:
            payload = _admin_cached(
                f"users:{viewer_uid}",
                90.0,
                lambda: admin.get_users(
                    firestore_client(), viewer_uid, viewer_role, query
                ),
            )
        return {"success": True, **payload}
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "Admin data couldn’t be loaded.")


@app.get("/v1/admin/logs")
async def admin_logs(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    try:
        return {
            "success": True,
            **_admin_cached(
                "logs", 60.0, lambda: admin.get_logs(firestore_client())
            ),
        }
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "Admin data couldn’t be loaded.")


@app.get("/v1/admin/live-logs")
async def admin_live_logs(request: Request):
    """The realtime server log stream (app/logstream.py).
    Reads Redis only — ZERO Firestore reads beyond the gate's
    cached role lookup — so the panel can poll it every few
    seconds without touching the Spark read quota."""
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    import asyncio

    try:
        limit = int(request.query_params.get("limit") or 100)
    except (TypeError, ValueError):
        limit = 100
    service = request.query_params.get("service") or ""
    level = request.query_params.get("level") or ""
    try:
        payload = await asyncio.to_thread(
            logstream.read, limit, service, level
        )
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "Admin data couldn’t be loaded.")
    return {"success": True, **payload}


@app.get("/v1/admin/media")
async def admin_media_list(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    try:
        return {"success": True, **admin.list_media(request.query_params.get("prefix", ""))}
    except Exception:
        return _error(503, "MEDIA_UNAVAILABLE", "Media couldn’t be loaded.")


@app.post("/v1/admin/media/delete")
async def admin_media_delete(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    actor_uid, _actor_email, actor_role = gate
    try:
        body = await request.json()
    except Exception:
        return _error(400, "INVALID_JSON", "Send a JSON body.")
    if not isinstance(body, dict) or not isinstance(body.get("publicId"), str):
        return _error(400, "INVALID_BODY", "Send the media reference to delete.")
    try:
        result = admin.delete_media(
            firestore_client(),
            actor_uid,
            actor_role,
            body["publicId"],
            body.get("resourceType") if isinstance(body.get("resourceType"), str) else "",
            body.get("deliveryType") if isinstance(body.get("deliveryType"), str) else "",
        )
        return {"success": True, **result}
    except admin.AdminAuthError as error:
        return _error(error.status, error.code, error.message)


@app.post("/v1/admin/media/upload")
async def admin_media_upload(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    actor_uid, _actor_email, actor_role = gate
    try:
        form = await request.form()
        upload = form.get("file")
        from starlette.datastructures import UploadFile

        if not isinstance(upload, UploadFile):
            return _error(400, "INVALID_BODY", "Attach a file to upload.")
        data = await upload.read()
        resource_type = form.get("resourceType")
        result = admin.upload_media(
            firestore_client(),
            actor_uid,
            actor_role,
            upload.filename or "upload",
            data,
            resource_type if isinstance(resource_type, str) else "",
        )
        return {"success": True, "resource": result}
    except admin.AdminAuthError as error:
        return _error(error.status, error.code, error.message)


@app.get("/v1/admin/media/download")
async def admin_media_download(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    params = request.query_params
    public_id = params.get("publicId", "")
    resource_type = params.get("resourceType", "")
    delivery_type = params.get("type", "authenticated")
    format_ = params.get("format", "") if resource_type == "image" else ""
    if not public_id or resource_type not in ("image", "raw"):
        return _error(400, "INVALID_MEDIA", "That media reference isn’t valid.")
    try:
        content, content_type = admin.download_media(
            public_id, resource_type, format_, delivery_type
        )
    except admin.AdminAuthError as error:
        return _error(error.status, error.code, error.message)
    from fastapi.responses import Response

    filename = public_id.rsplit("/", 1)[-1]
    if format_ and not filename.endswith(f".{format_}"):
        filename = f"{filename}.{format_}"
    return Response(
        content=content,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/v1/admin/storage")
async def admin_storage(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    try:
        return {"success": True, **admin.get_storage(firestore_client())}
    except Exception:
        return _error(
            503, "STORAGE_UNAVAILABLE", "Storage statistics couldn’t be loaded."
        )


@app.get("/v1/admin/trash")
async def admin_trash(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    try:
        return {"success": True, **admin.get_trash(firestore_client())}
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "Admin data couldn’t be loaded.")


@app.post("/v1/admin/verify-owner-secret")
async def admin_verify_owner_secret(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    _actor_uid, _actor_email, actor_role = gate
    try:
        body = await request.json()
    except Exception:
        return _error(400, "INVALID_JSON", "Send a JSON body.")
    provided = body.get("ownerSecret") if isinstance(body, dict) else None
    try:
        return admin.verify_owner_secret(
            actor_role, provided if isinstance(provided, str) else None
        )
    except admin.AdminAuthError as error:
        return _error(error.status, error.code, error.message)


@app.get("/v1/admin/users/{uid}")
async def admin_user_detail(request: Request, uid: str):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    try:
        return {
            "success": True,
            **admin.get_user_detail(firestore_client(), uid),
        }
    except admin.AdminAuthError as error:
        return _error(error.status, error.code, error.message)
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "Admin data couldn’t be loaded.")


@app.get("/v1/admin/flags")
async def admin_flags(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    try:
        status = request.query_params.get("status") or ""
        return {"success": True, **admin.get_flags(firestore_client(), status)}
    except admin.AdminAuthError as error:
        return _error(error.status, error.code, error.message)
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "Admin data couldn’t be loaded.")


@app.post("/v1/admin/flags/{flag_id}/review")
async def admin_flag_review(request: Request, flag_id: str):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    actor_uid, _actor_email, actor_role = gate
    try:
        body = await request.json()
    except Exception:
        return _error(400, "INVALID_JSON", "Send a JSON body.")
    if not isinstance(body, dict) or not isinstance(body.get("status"), str):
        return _error(400, "INVALID_BODY", "Send the review decision.")
    try:
        result = admin.review_flag(
            firestore_client(), actor_uid, actor_role, flag_id, body["status"]
        )
        return {"success": True, **result}
    except admin.AdminAuthError as error:
        return _error(error.status, error.code, error.message)
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "The review couldn’t be saved.")


@app.get("/v1/admin/users/{uid}/chats")
async def admin_user_chats(request: Request, uid: str):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    try:
        return {"success": True, **admin.get_user_chats(firestore_client(), uid)}
    except admin.AdminAuthError as error:
        return _error(error.status, error.code, error.message)
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "Admin data couldn’t be loaded.")


@app.get("/v1/admin/users/{uid}/chats/{chat_id}")
async def admin_user_chat_messages(request: Request, uid: str, chat_id: str):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    actor_uid, _actor_email, actor_role = gate
    try:
        return {
            "success": True,
            **admin.get_user_chat_messages(
                firestore_client(), actor_uid, actor_role, uid, chat_id
            ),
        }
    except admin.AdminAuthError as error:
        return _error(error.status, error.code, error.message)
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "Admin data couldn’t be loaded.")


@app.post("/v1/admin/users/create")
async def admin_users_create(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    actor_uid, _actor_email, actor_role = gate
    try:
        body = await request.json()
    except Exception:
        return _error(400, "INVALID_JSON", "Send a JSON body.")
    if not isinstance(body, dict):
        return _error(400, "INVALID_BODY", "Send a JSON object.")
    email = body.get("email")
    password = body.get("password")
    if not isinstance(email, str) or not isinstance(password, str):
        return _error(
            400, "INVALID_CREATE", "An email and a temporary password are required."
        )
    display_name = body.get("displayName")
    email_verified = body.get("emailVerified")
    try:
        result = admin.create_user_account(
            firestore_client(),
            actor_uid,
            actor_role,
            email,
            password,
            display_name=display_name if isinstance(display_name, str) else None,
            email_verified=email_verified if isinstance(email_verified, bool) else True,
        )
    except admin.AdminAuthError as error:
        return _error(error.status, error.code, error.message)
    except Exception:
        return _error(503, "CREATE_FAILED", "The account couldn’t be created.")
    return {"success": True, **result}


def _owner_gate_error(gate):
    """The database explorer is the owner's master data access:
    a plain admin's token is not enough. Returns a 403 response
    for non-owners, None for the owner."""
    _uid, _email, role = gate
    if role != "owner":
        return _error(
            403,
            "OWNER_ONLY",
            "The database explorer is available to the owner only.",
        )
    return None


@app.get("/v1/admin/database/collections")
async def admin_database_collections(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    denied = _owner_gate_error(gate)
    if denied is not None:
        return denied
    try:
        return {
            "success": True,
            **_admin_cached(
                "database:collections",
                30.0,
                lambda: admin.database_collections(firestore_client()),
            ),
        }
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "Admin data couldn’t be loaded.")


@app.get("/v1/admin/database/docs")
async def admin_database_docs(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    denied = _owner_gate_error(gate)
    if denied is not None:
        return denied
    path = request.query_params.get("path") or ""
    start_after = request.query_params.get("startAfter") or ""
    try:
        limit = int(request.query_params.get("limit") or 25)
    except (TypeError, ValueError):
        limit = 25
    try:
        payload = admin.database_documents(
            firestore_client(), path, limit, start_after
        )
    except admin.AdminAuthError as error:
        return _error(error.status, error.code, error.message)
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "Admin data couldn’t be loaded.")
    return {"success": True, **payload}


@app.get("/v1/admin/database/doc")
async def admin_database_doc(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    denied = _owner_gate_error(gate)
    if denied is not None:
        return denied
    actor_uid, _email, actor_role = gate
    path = request.query_params.get("path") or ""
    try:
        payload = admin.database_document(
            firestore_client(), path, actor_uid, actor_role
        )
    except admin.AdminAuthError as error:
        return _error(error.status, error.code, error.message)
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "Admin data couldn’t be loaded.")
    return {"success": True, **payload}


@app.patch("/v1/admin/users")
async def admin_users_patch(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    actor_uid, actor_email, actor_role = gate
    try:
        body = await request.json()
    except Exception:
        return _error(400, "INVALID_JSON", "Send a JSON body.")
    if not isinstance(body, dict):
        return _error(400, "INVALID_BODY", "Send a JSON object.")
    target = body.get("uid")
    action = body.get("action")
    if not isinstance(target, str) or not isinstance(action, str):
        return _error(400, "INVALID_ACTION", "A target user and action are required.")
    try:
        provided_secret = body.get("ownerSecret")
        duration = body.get("durationHours")
        reason = body.get("reason")
        result = admin.patch_user(
            firestore_client(),
            actor_uid,
            actor_role,
            actor_email,
            target,
            action,
            owner_secret_value=provided_secret if isinstance(provided_secret, str) else None,
            duration_hours=duration
            if isinstance(duration, int) and not isinstance(duration, bool)
            else None,
            suspend_reason=reason if isinstance(reason, str) else "",
        )
    except admin.AdminAuthError as error:
        return _error(error.status, error.code, error.message)
    except Exception:
        return _error(503, "ACTION_FAILED", "That action couldn’t be completed.")
    return {"success": True, **result}


@app.post("/v1/bot/verify")
async def bot_verify(request: Request):
    """Complete a human verification. The main app forwards the
    Turnstile token its /bot-check page collected, together with
    the visitor's IP and user agent as the app saw them. On
    success the IP's bot-protection flags clear and a signed
    human pass (30 minutes, IP + UA bound) is minted for the app
    to present on later calls."""
    if not auth.check_service_token(request.headers.get("x-service-token")):
        return _error(401, "UNAUTHORIZED", "Invalid service token.")
    try:
        body = await request.json()
    except Exception:
        return _error(400, "INVALID_JSON", "Send a JSON body.")
    if not isinstance(body, dict):
        return _error(400, "INVALID_BODY", "Send a JSON object.")
    ip = body.get("ip") if isinstance(body.get("ip"), str) else _client_ip(request)
    user_agent = (
        body.get("userAgent") if isinstance(body.get("userAgent"), str) else ""
    )
    ok, _reason = await security.verify_turnstile(
        body.get("token") if isinstance(body.get("token"), str) else None,
        ip,
    )
    if not ok:
        return _error(
            403,
            "BOT_VERIFICATION_FAILED",
            "Human verification could not be completed. Please try again.",
        )
    security.clear_flags(ip)
    return {
        "success": True,
        "pass": security.mint_pass(ip, user_agent),
        "expiresInSeconds": security.PASS_SECONDS,
    }


@app.post("/v1/images/watermark")
async def image_watermark(request: Request):
    """Embed (action "embed") or read back (action "extract") the
    invisible watermark in a PNG's pixels, via the C core."""
    if not auth.check_service_token(request.headers.get("x-service-token")):
        return _error(401, "UNAUTHORIZED", "Invalid service token.")
    try:
        body = await request.json()
    except Exception:
        return _error(400, "INVALID_JSON", "Send a JSON body.")
    action = body.get("action")
    image_b64 = body.get("imageBase64")
    if action not in ("embed", "extract") or not isinstance(image_b64, str):
        return _error(400, "INVALID_REQUEST", "Send {action, imageBase64, payload?}.")
    try:
        raw = base64.b64decode(image_b64, validate=True)
        from PIL import Image

        image = Image.open(io.BytesIO(raw)).convert("RGB")
        pixels = bytearray(image.tobytes())
        if action == "embed":
            payload = body.get("payload")
            if not isinstance(payload, str) or not payload or len(payload) > 512:
                return _error(400, "INVALID_PAYLOAD", "Payload must be 1-512 characters.")
            stamped = watermark.embed(pixels, payload.encode())
            image = Image.frombytes("RGB", image.size, bytes(stamped))
            out = io.BytesIO()
            image.save(out, format="PNG")
            return {
                "success": True,
                "engine": "c" if watermark.using_c_core() else "python",
                "imageBase64": base64.b64encode(out.getvalue()).decode(),
            }
        payload = watermark.extract(pixels)
        return {
            "success": True,
            "engine": "c" if watermark.using_c_core() else "python",
            "payload": payload.decode("utf-8", "replace"),
        }
    except ValueError as error:
        return _error(422, "WATERMARK_FAILED", str(error))
    except Exception:
        return _error(422, "INVALID_IMAGE", "The image could not be processed.")

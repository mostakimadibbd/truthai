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

from . import admin, auth, jobs, models as model_lib, openrouter as openrouter_lib, security, watermark
from .config import app_public_url, settings
from .firebase import firestore_client

app = FastAPI(title="Xyro AI Backend", docs_url=None, redoc_url=None)


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"success": False, "error": {"code": code, "message": message}},
    )


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


@app.get("/v1/admin/overview")
async def admin_overview(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    try:
        return {"success": True, **admin.get_overview(firestore_client())}
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "Admin data couldn’t be loaded.")


@app.get("/v1/admin/audit")
async def admin_audit(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    try:
        return {"success": True, **admin.get_audit(firestore_client())}
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
        return {
            "success": True,
            **admin.get_users(firestore_client(), viewer_uid, viewer_role, query),
        }
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "Admin data couldn’t be loaded.")


@app.get("/v1/admin/logs")
async def admin_logs(request: Request):
    gate = await _admin_gate(request)
    if isinstance(gate, JSONResponse):
        return gate
    try:
        return {"success": True, **admin.get_logs(firestore_client())}
    except Exception:
        return _error(503, "ADMIN_UNAVAILABLE", "Admin data couldn’t be loaded.")


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
        result = admin.patch_user(
            firestore_client(),
            actor_uid,
            actor_role,
            actor_email,
            target,
            action,
            owner_secret_value=provided_secret if isinstance(provided_secret, str) else None,
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

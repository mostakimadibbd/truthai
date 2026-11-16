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

from . import admin, auth, jobs, models as model_lib, watermark
from .config import settings
from .firebase import firestore_client

app = FastAPI(title="Xyro AI Backend", docs_url=None, redoc_url=None)


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"success": False, "error": {"code": code, "message": message}},
    )


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
    return {
        "ok": True,
        "service": "xyro-backend",
        "integrations": checks,
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
    try:
        return {
            "success": True,
            **admin.get_users(firestore_client(), viewer_uid, viewer_role),
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
        return {"success": True, **admin.get_storage()}
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
        result = admin.patch_user(
            firestore_client(), actor_uid, actor_role, actor_email, target, action
        )
    except admin.AdminAuthError as error:
        return _error(error.status, error.code, error.message)
    except Exception:
        return _error(503, "ACTION_FAILED", "That action couldn’t be completed.")
    return {"success": True, **result}


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

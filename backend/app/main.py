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

from . import auth, jobs, models as model_lib, watermark
from .config import settings

app = FastAPI(title="Xyro AI Backend", docs_url=None, redoc_url=None)


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"success": False, "error": {"code": code, "message": message}},
    )


@app.get("/health")
async def health() -> dict:
    checks = settings.health()
    return {
        "ok": True,
        "service": "xyro-backend",
        "integrations": checks,
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

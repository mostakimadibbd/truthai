"""Job registry + worker dispatch.

Jobs live in memory (status, result, error) and are mirrored to
the Firestore `chatJobs` collection (Admin SDK only; the security
rules deny client access) so status survives a service restart
for polling purposes. Execution is decoupled from submission: a
job is an asyncio task bounded by a semaphore that caps how many
upstream generations run at once — that cap is what protects the
free-tier upstream quotas when thousands of requests arrive; the
HTTP layer itself stays fast because submission is just a queue
insert.
"""
from __future__ import annotations

import asyncio
import time
import uuid

from . import chatjob
from .config import settings

_jobs: dict[str, dict] = {}
_semaphore = asyncio.Semaphore(settings.max_concurrent_upstream)


def _now_ms() -> int:
    return int(time.time() * 1000)


def submit_chat_job(payload: dict, db, rtdb_ref) -> dict:
    job_id = uuid.uuid4().hex
    job = {
        "id": job_id,
        "kind": "chat",
        "status": "queued",
        "uid": payload["uid"],
        "chatId": payload["chatId"],
        "userMessageId": payload["userMessageId"],
        "assistantMessageId": payload["assistantMessageId"],
        "responseId": payload["responseId"],
        "content": payload["content"],
        "model": payload.get("model"),
        "createdAt": _now_ms(),
        "result": None,
        "error": None,
    }
    job["_done"] = asyncio.Event()
    _jobs[job_id] = job
    asyncio.get_running_loop().create_task(_run(job, db, rtdb_ref))
    return {"jobId": job_id, "status": "queued"}


async def wait_for_job(job_id: str, timeout: float) -> dict | None:
    """Block until a job reaches a terminal state (sync mode)."""
    job = _jobs.get(job_id)
    if job is None:
        return None
    try:
        await asyncio.wait_for(job["_done"].wait(), timeout=timeout)
    except asyncio.TimeoutError:
        pass
    return {
        "jobId": job["id"],
        "status": job["status"],
        "result": job.get("result"),
        "error": job.get("error"),
    }


async def _run(job: dict, db, rtdb_ref) -> None:
    async with _semaphore:
        job["status"] = "running"
        job["startedAt"] = _now_ms()
        try:
            result = await asyncio.wait_for(
                chatjob.execute_chat_job(job, db, rtdb_ref),
                timeout=settings.job_timeout_seconds,
            )
            job["status"] = "complete"
            job["result"] = result
        except chatjob.ChatJobError as error:
            job["status"] = "failed"
            job["error"] = {
                "status": error.status,
                "code": error.code,
                "message": error.message,
            }
        except asyncio.TimeoutError:
            job["status"] = "failed"
            job["error"] = {
                "status": 503,
                "code": "MODEL_UNAVAILABLE",
                "message": "The free model service is temporarily unavailable.",
            }
        except Exception as error:  # never leave a job hanging
            job["status"] = "failed"
            job["error"] = {
                "status": 500,
                "code": "JOB_FAILED",
                "message": "Something went wrong while generating the reply.",
            }
            print(f"Chat job {job['id']} failed unexpectedly: {error!r}")
        finally:
            job["finishedAt"] = _now_ms()
            _mirror(job, db)
            job["_done"].set()


def _mirror(job: dict, db) -> None:
    try:
        from firebase_admin import firestore

        db.collection("chatJobs").document(job["id"]).set(
            {
                "kind": job["kind"],
                "status": job["status"],
                "uid": job["uid"],
                "chatId": job["chatId"],
                "error": job.get("error"),
                "result": job.get("result"),
                "createdAt": job["createdAt"],
                "updatedAt": firestore.SERVER_TIMESTAMP,
            }
        )
    except Exception as error:
        print(f"Job mirror write failed for {job['id']}: {error}")


def get_job(job_id: str, uid: str) -> dict | None:
    job = _jobs.get(job_id)
    if job is None or job["uid"] != uid:
        return None
    return {
        "jobId": job["id"],
        "status": job["status"],
        "result": job.get("result"),
        "error": job.get("error"),
    }

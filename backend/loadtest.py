"""Local load test for the Xyro backend.

Measures three things, honestly scoped:
  1. HTTP throughput of the running service (GET /health) — the
     ceiling of the web layer itself.
  2. Job-pipeline drain rate: N chat jobs executed end-to-end
     against an in-memory Firestore and an instant stub model —
     this measures OUR pipeline (queue, writes, stream publish,
     save), not OpenRouter. Production chat throughput is bounded
     by OpenRouter's free-tier limits, not by this service.
  3. Watermark embed speed, C core vs pure Python, on a
     2048x2048 RGB frame.

Usage: python loadtest.py [port]
"""
from __future__ import annotations

import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("SESSION_SECRET", "loadtest-secret")
os.environ.setdefault("BACKEND_SERVICE_TOKEN", "loadtest-token")

import httpx  # noqa: E402

from app import chatjob, jobs, watermark  # noqa: E402
from tests.fakes import FakeFirestore, make_rtdb  # noqa: E402

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
BASE = f"http://127.0.0.1:{PORT}"


async def bench_health(total: int = 3000, concurrency: int = 100) -> None:
    semaphore = asyncio.Semaphore(concurrency)
    done = 0

    async def one(client: httpx.AsyncClient) -> None:
        nonlocal done
        async with semaphore:
            response = await client.get(f"{BASE}/health")
            assert response.status_code == 200
            done += 1

    started = time.perf_counter()
    async with httpx.AsyncClient(timeout=30, trust_env=False) as client:
        await asyncio.gather(*[one(client) for _ in range(total)])
    elapsed = time.perf_counter() - started
    print(f"health: {total} requests in {elapsed:.2f}s = {total / elapsed:,.0f} req/s")


async def bench_jobs(count: int = 300) -> None:
    db = FakeFirestore()
    rtdb_ref = make_rtdb({})
    for i in range(count):
        db.store[f"users/u{i}/chats/c{i}"] = {"title": "New chat", "searchText": ""}

    async def fake_stream(attempts, messages, on_text, **kwargs):
        await on_text("Benchmark reply")
        return {
            "model": "openrouter/free",
            "text": "Benchmark reply",
            "usage": {"promptTokens": 10, "completionTokens": 4},
        }

    chatjob.openrouter.stream_completion = fake_stream
    chatjob.analytics.record_usage_event = lambda db_, **kw: None

    started = time.perf_counter()
    ids = []
    for i in range(count):
        submitted = jobs.submit_chat_job(
            {
                "uid": f"u{i}",
                "chatId": f"c{i}",
                "userMessageId": f"mu{i}",
                "assistantMessageId": f"ma{i}",
                "responseId": f"r{i}",
                "content": "Benchmark message",
                "model": None,
            },
            db,
            rtdb_ref,
        )
        ids.append((submitted["jobId"], f"u{i}"))
    while True:
        states = [jobs.get_job(j, u)["status"] for j, u in ids]
        if all(s in ("complete", "failed") for s in states):
            break
        await asyncio.sleep(0.05)
    elapsed = time.perf_counter() - started
    complete = states.count("complete")
    print(
        f"jobs: {complete}/{count} completed in {elapsed:.2f}s "
        f"= {count / elapsed:,.1f} jobs/s end-to-end (stub model, in-memory DB)"
    )


def bench_watermark() -> None:
    size = 2048 * 2048 * 3
    buf = bytes((i * 7) % 256 for i in range(size))
    payload = b"xyro:loadtest-generation"

    started = time.perf_counter()
    watermark.embed(buf, payload)
    c_seconds = time.perf_counter() - started

    lib, watermark._lib = watermark._lib, None
    try:
        started = time.perf_counter()
        watermark.embed(buf, payload)
        py_seconds = time.perf_counter() - started
    finally:
        watermark._lib = lib
    print(
        f"watermark 2048x2048 ({size / 1e6:.1f} MB): "
        f"C {c_seconds * 1000:.0f} ms vs Python {py_seconds * 1000:.0f} ms "
        f"({py_seconds / max(c_seconds, 1e-9):.0f}x faster in C)"
    )


async def main() -> None:
    await bench_health()
    await bench_jobs()
    bench_watermark()


if __name__ == "__main__":
    asyncio.run(main())

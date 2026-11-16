# Xyro AI backend service (Python + C)

A persistent, job-based execution service that sits behind the
Next.js app. It exists to do the one thing serverless functions
cannot promise: **finish the work after the user is gone.**

Today, if a user closes the tab mid-reply, the browser aborts the
request and the Vercel function stops with it. With this service,
a chat turn is a *job*: the Next.js `/api/chat` route submits it
and the job runs to completion here — streaming progress to
Realtime Database and saving the finished reply to Firestore —
whether or not anyone is still watching. When the user returns,
the answer is simply there.

## What it does

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Integration booleans + watermark engine, mirroring `/api/health` |
| `POST /v1/chat/jobs` | Submit a chat turn → `202 {jobId}`; runs async to completion |
| `GET /v1/chat/jobs/{id}` | Job status (`queued`/`running`/`complete`/`failed` + error shape) |
| `GET /v1/models` | The free-model catalogue (same free-only rules as the web app) |
| `POST /v1/images/watermark` | Embed/extract the invisible image watermark (C core) |

Chat execution mirrors the Next.js route's behaviour exactly:
the same Firestore message pair (shared timestamp, reply +1 ms),
the same RTDB stream node (`chatStreams/{uid}/{chatId}` with
`responseId`/`seq`/`phase`), the same fallback chain across free
models, the same usage metering and failure ledger (`chatErrors`).

## Design rules it keeps

- **Free models only.** The owner's OpenRouter account has no
  credit. The catalogue is filtered to free entries, requested
  models are validated against it, and every attempt chain passes
  through `free_only_attempts` — a paid call is structurally
  impossible, not just unlikely.
- **Nobody is trusted.** Every job call re-verifies the caller's
  service token (constant-time compare), the user's session JWT
  (HS256, `SESSION_SECRET`, absolute expiry, Redis revocation),
  and the Firebase ID token — uid must match across all three.
- **Upstream is capped, the web layer is not.** Submission is a
  queue insert (fast under load); a semaphore
  (`BACKEND_MAX_CONCURRENT_UPSTREAM`, default 8) bounds how many
  generations hit OpenRouter at once, which is what protects the
  free-tier quotas when traffic spikes.

## The C component

`c/watermark.c` implements the invisible image watermark (LSB
frame format) in C; `app/watermark.py` calls it via `ctypes` and
falls back to an identical pure-Python implementation when the
shared library is absent. `GET /health` reports which engine is
live (`watermarkEngine`). Build it with `make -C c` (the Docker
build does this for you).

Honest measurement note: the embed algorithm touches only the
payload region of the buffer, so at production payload sizes both
engines finish in well under a millisecond — the C core is the
native implementation of the format, not a speed claim.

## Performance (measured locally, 2026-11-16)

Same-VM load test (`loadtest.py`, client and server sharing a
small throttled VM — treat as a floor, not a ceiling):

- `GET /health`: **~630 requests/second** sustained.
- Job pipeline: **~610 jobs/second** end-to-end (queue → message
  writes → stream publish → final save) against an instant stub
  model and in-memory database.

Real chat throughput is **not** bounded by this service: it is
bounded by OpenRouter's free tier (≈50 free requests/day on an
account without credit, plus per-model rate limits) and by
Firestore's Spark quotas. No backend language changes those
numbers; what this architecture changes is durability (jobs
survive disconnects), headroom (the web layer stays fast while
generations queue), and cost of scaling later (raise the
semaphore and the quotas, nothing else moves).

## Running it

Local:

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
make -C c
uvicorn app.main:app --port 8000 --workers 1
python tests/test_units.py   # 8 checks, no credentials needed
```

Docker: `docker build -t xyro-backend .` then run with the env
below.

### Free hosting options

- **Hugging Face Spaces (Docker SDK)** — free CPU tier, no card.
  Point the Space at this folder's Dockerfile; it sleeps after
  inactivity, so the first request after a nap is slow (the
  Next.js side falls back to local execution whenever the service
  doesn't answer, so a sleeping backend never breaks chat).
- **Render free web service** — Docker deploy; spins down after
  15 idle minutes, same fallback behaviour applies.
- **Any VPS** — `docker run` behind HTTPS; the service expects to
  sit behind the Next.js proxy, never directly exposed without
  the service token.

## Configuration

Shared with the Next.js app (same values):

- `SESSION_SECRET`
- `OPENROUTER_API_KEY`
- `FIREBASE_SERVICE_ACCOUNT_JSON` — the service account JSON as a
  single line (the Next.js app takes the same key split into
  parts; this is the portable form)
- `NEXT_PUBLIC_FIREBASE_DATABASE_URL` (or `FIREBASE_DATABASE_URL`)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

Backend-only:

- `BACKEND_SERVICE_TOKEN` — a long random secret; set the **same**
  value in Vercel so the Next.js route can call this service.
- `BACKEND_URL` — set **in Vercel** to this service's base URL.
  This is the switch: unset it and the site runs exactly as
  before, with zero delegation.
- `BACKEND_MAX_CONCURRENT_UPSTREAM` (default 8)
- `BACKEND_JOB_TIMEOUT_SECONDS` (default 280)
- `OPENROUTER_BASE_URL` (testing only)

## Scope of this version

Delegation covers plain-text chat turns. Turns with attachments,
web search, or regeneration keep running on the existing Next.js
route (the proxy decides per turn), so nothing regresses; those
paths can move here incrementally.

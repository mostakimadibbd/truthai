"""Realtime log stream, stored in Upstash Redis (2026-11-18).

The owner wants the panel's logs to be the services' real,
live server logs — and wants Firestore reads optimised,
because the Spark plan's 50k reads/day is the quota that keeps
running out. So the log pipeline avoids Firestore entirely:

* every service writes structured log entries to ONE capped
  Redis list (LPUSH + LTRIM, newest first, last 1000 kept) —
  Redis is already connected for the admin-auth throttle, and
  a read of the latest 100 entries costs ONE Redis command
  and ZERO Firestore reads;
* every entry is ALSO printed to stdout, so Vercel's own log
  view keeps showing the same lines (Vercel logs are the
  services' stdout — this module captures those lines at the
  source and stores them where the panel can stream them).

Writes are best-effort on a background thread: logging must
never add latency to, or break, the request that produced it.
"""

from __future__ import annotations

import json
import threading
import time
from urllib.parse import quote

import httpx

from .config import settings

STREAM_KEY = "xyro:logstream"
MAX_ENTRIES = 1000
SERVICES = ("truthai", "xyro-backend")


def _command(*parts: str) -> object | None:
    """One Upstash REST command; None when unconfigured or
    unreachable (same pattern as admin._upstash_command)."""
    if not (settings.upstash_rest_url and settings.upstash_rest_token):
        return None
    try:
        path = "/".join(quote(str(part), safe="") for part in parts)
        with httpx.Client(timeout=2.0) as client:
            response = client.post(
                f"{settings.upstash_rest_url}/{path}",
                headers={"Authorization": f"Bearer {settings.upstash_rest_token}"},
            )
            response.raise_for_status()
            return response.json().get("result")
    except Exception:
        return None


def _push(payload: str) -> None:
    _command("LPUSH", STREAM_KEY, payload)
    _command("LTRIM", STREAM_KEY, "0", str(MAX_ENTRIES - 1))


def emit(service: str, level: str, message: str, meta: dict | None = None) -> None:
    """Record one log entry. `level` is info | warn | error.
    Never raises and never blocks the caller."""
    text = " ".join(str(message).split())[:500]
    print(f"[{service}] {level.upper()} {text}", flush=True)
    entry: dict = {
        "ts": int(time.time() * 1000),
        "service": service,
        "level": level if level in ("info", "warn", "error") else "info",
        "message": text,
    }
    if meta:
        entry["meta"] = meta
    try:
        payload = json.dumps(entry)
    except Exception:
        return
    threading.Thread(target=_push, args=(payload,), daemon=True).start()


def read(limit: int = 100, service: str = "", level: str = "") -> dict:
    """The newest entries, optionally filtered. One Redis
    command; overscan ×4 so filters still fill the page."""
    limit = max(1, min(int(limit or 100), 200))
    raw = _command("LRANGE", STREAM_KEY, "0", str(min(limit * 4, MAX_ENTRIES) - 1))
    entries: list[dict] = []
    if isinstance(raw, list):
        for item in raw:
            try:
                entry = json.loads(item)
            except Exception:
                continue
            if not isinstance(entry, dict):
                continue
            if service and entry.get("service") != service:
                continue
            if level and entry.get("level") != level:
                continue
            entries.append(entry)
            if len(entries) >= limit:
                break
    return {
        "entries": entries,
        "configured": bool(settings.upstash_rest_url and settings.upstash_rest_token),
    }

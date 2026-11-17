"""Bot protection + request-hardening state for the backend.

Threat model: this service is reachable from the public internet.
Its real callers are servers (the main app, the admin panel) that
authenticate with the service token — everyone else is a guest,
and guests get watched:

- Scanner probes (/.env, /.git, wp-admin, *.php, …) earn an
  immediate timed IP block.
- Bursts of failed admin authentication first FLAG the IP; a
  flagged caller must complete a human verification (Cloudflare
  Turnstile, completed on the main app's /bot-check page) before
  /v1/ calls are served again. More failures earn a block.
- 404 floods flag the IP the same way.
- A successful verification mints a short-lived HMAC "human pass"
  bound to the IP + user-agent hash; the main app carries it on
  later calls so a verified human is not challenged repeatedly.

State is in-memory per process (the same trade-off as the admin
auth throttle): on Vercel each instance keeps its own counters,
which blunts floods without any extra infrastructure. Nothing
here ever blocks a caller presenting the service token — the
panel and the main app must never be locked out by heuristics.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time

import httpx

from .config import settings, turnstile_secret

WINDOW_SECONDS = 300
FLAG_AUTH_FAILURES = 8
BLOCK_AUTH_FAILURES = 20
FLAG_NOT_FOUND = 12
BLOCK_SECONDS = 15 * 60
FLAG_SECONDS = 30 * 60
PASS_SECONDS = 30 * 60
RATE_WINDOW_SECONDS = 60
RATE_LIMIT_PER_MINUTE = 240

SCANNER_MARKERS = (
    ".env",
    ".git/",
    "wp-admin",
    "wp-login",
    "phpmyadmin",
    ".php",
    "cgi-bin",
    "/actuator",
    ".aws",
    "server-status",
    ".bak",
    ".sql",
    "config.json",
)


class _IpState:
    __slots__ = ("failures", "not_founds", "requests", "blocked_until", "flagged_until")

    def __init__(self) -> None:
        self.failures: list[float] = []
        self.not_founds: list[float] = []
        self.requests: list[float] = []
        self.blocked_until = 0.0
        self.flagged_until = 0.0


_STATE: dict[str, _IpState] = {}


def _state_for(ip: str) -> _IpState:
    state = _STATE.get(ip)
    if state is None:
        state = _IpState()
        _STATE[ip] = state
    return state


def _prune(values: list[float], now: float, window: float) -> list[float]:
    return [stamp for stamp in values if now - stamp < window]


def is_scanner_path(path: str) -> bool:
    lowered = path.lower()
    return any(marker in lowered for marker in SCANNER_MARKERS)


def record_scanner_hit(ip: str) -> None:
    _state_for(ip).blocked_until = time.time() + BLOCK_SECONDS


def record_auth_failure(ip: str) -> None:
    now = time.time()
    state = _state_for(ip)
    state.failures = _prune(state.failures, now, WINDOW_SECONDS)
    state.failures.append(now)
    if len(state.failures) >= BLOCK_AUTH_FAILURES:
        state.blocked_until = now + BLOCK_SECONDS
    elif len(state.failures) >= FLAG_AUTH_FAILURES:
        state.flagged_until = now + FLAG_SECONDS


def record_not_found(ip: str) -> None:
    now = time.time()
    state = _state_for(ip)
    state.not_founds = _prune(state.not_founds, now, WINDOW_SECONDS)
    state.not_founds.append(now)
    if len(state.not_founds) >= FLAG_NOT_FOUND:
        state.flagged_until = now + FLAG_SECONDS


def rate_limited(ip: str) -> bool:
    now = time.time()
    state = _state_for(ip)
    state.requests = _prune(state.requests, now, RATE_WINDOW_SECONDS)
    state.requests.append(now)
    return len(state.requests) > RATE_LIMIT_PER_MINUTE


def decision(ip: str, path: str) -> str:
    """'block', 'challenge' or 'allow' for an untrusted caller."""
    if is_scanner_path(path):
        record_scanner_hit(ip)
        return "block"
    state = _STATE.get(ip)
    if state is None:
        return "allow"
    now = time.time()
    if state.blocked_until > now:
        return "block"
    if state.flagged_until > now:
        return "challenge"
    return "allow"


def clear_flags(ip: str) -> None:
    _STATE.pop(ip, None)


# --- Human passes ---------------------------------------------------


def _pass_key() -> bytes:
    material = settings.session_secret or settings.service_token
    return hashlib.sha256(f"xyro-human-pass:{material}".encode()).digest()


def _ua_hash(user_agent: str | None) -> str:
    return hashlib.sha256((user_agent or "").encode()).hexdigest()[:16]


def mint_pass(ip: str, user_agent: str | None) -> str:
    expires = int(time.time()) + PASS_SECONDS
    payload = f"{ip}|{_ua_hash(user_agent)}|{expires}"
    signature = hmac.new(_pass_key(), payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}|{signature}".encode()).decode()


def check_pass(token: str | None, ip: str, user_agent: str | None) -> bool:
    if not token:
        return False
    try:
        raw = base64.urlsafe_b64decode(token.encode())
        # Canonical form only: base64 decoding alone would ignore
        # some appended junk characters, so a presented token must
        # re-encode to exactly itself.
        if base64.urlsafe_b64encode(raw).decode() != token:
            return False
        decoded = raw.decode()
        payload, signature = decoded.rsplit("|", 1)
        pass_ip, ua_hash, expires_text = payload.split("|")
        expires = int(expires_text)
    except Exception:
        return False
    expected = hmac.new(_pass_key(), payload.encode(), hashlib.sha256).hexdigest()
    return (
        hmac.compare_digest(signature, expected)
        and pass_ip == ip
        and ua_hash == _ua_hash(user_agent)
        and expires > int(time.time())
    )


# --- Turnstile verification ------------------------------------------


async def verify_turnstile(token: str | None, ip: str) -> tuple[bool, str]:
    """Verify a Turnstile token with Cloudflare. Returns
    (ok, reason) — reason is a coarse machine string, never
    anything derived from the secret."""
    secret = turnstile_secret()
    if not secret:
        return False, "not_configured"
    if not token:
        return False, "missing_token"
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            response = await client.post(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                data={"secret": secret, "response": token, "remoteip": ip},
            )
        payload = response.json()
    except Exception:
        return False, "verify_unreachable"
    if payload.get("success"):
        return True, "ok"
    return False, "rejected"

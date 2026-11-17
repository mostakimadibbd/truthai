import { SignJWT, jwtVerify } from "jose";
import { serverEnv } from "@/lib/server/env";
import type { NextRequest, NextResponse } from "next/server";
import { redisPipeline } from "@/lib/server/redis";

// Server session for Xyro AI. Turnstile gates this session, not just the
// auth forms: every app API requires BOTH this signed cookie and a
// Firebase ID token whose uid matches the cookie's uid, so a bot that
// talks to Firebase's public endpoints directly gets nothing from the
// product APIs.
//
// Cookie: __Host-xyro_session, HttpOnly, Secure, SameSite=Lax, Path=/.
// Payload: { uid, sid, iat, exp, absExp } as a signed HS256 JWT.
// Sliding expiry 30 days (re-issued when under 7 days remain); absolute
// expiry 90 days from the original sign-in.
//
// Revocation lives in Upstash Redis: `revoked:{sid}` (set on logout /
// per-session revoke) and `validAfter:{uid}` (set on "sign out
// everywhere" / password change). Both keys are read in one pipeline
// (2 commands) and cached in server memory for 30 s per (sid, uid).
// If Redis is not configured, revocation checks are skipped and sessions
// rely on cookie expiry alone — logout still clears the cookie, but a
// copied cookie stays technically valid until it expires. Configure
// Upstash in production so revocation is real.

export const SESSION_COOKIE_NAME = "__Host-xyro_session";

const SLIDING_MS = 30 * 24 * 60 * 60 * 1000;
const ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000;
const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
const REVOCATION_CACHE_MS = 30_000;

export type SessionResult =
  | {
      ok: true;
      uid: string;
      sid: string;
      /** True when the cookie should be re-issued (sliding refresh). */
      shouldRefresh: boolean;
      /** Epoch ms of the session's absolute expiry; needed to re-issue. */
      absExp: number;
    }
  | {
      ok: false;
      status: 401 | 503;
      code: string;
      message: string;
    };

function sessionSecret(): Uint8Array | null {
  const secret = serverEnv.sessionSecret;
  if (!secret || secret.length < 32) return null;
  return new TextEncoder().encode(secret);
}

export function isSessionConfigured(): boolean {
  return sessionSecret() !== null;
}

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    // The __Host- prefix requires Secure; local http development cannot
    // use the prefixed name, so fall back to a plain name there.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function sessionCookieName(): string {
  // __Host- requires the Secure attribute, which browsers reject over
  // plain http. Off production (local dev) use the unprefixed name.
  return process.env.NODE_ENV === "production"
    ? SESSION_COOKIE_NAME
    : "xyro_session";
}

async function signSession(payload: {
  uid: string;
  sid: string;
  absExp: number;
  exp: number;
}): Promise<string> {
  const secret = sessionSecret();
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  return new SignJWT({ sid: payload.sid, absExp: payload.absExp })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.uid)
    .setIssuedAt()
    .setExpirationTime(Math.floor(payload.exp / 1000))
    .sign(secret);
}

/**
 * Creates a fresh session for `uid` and sets the cookie on `response`.
 * Pass `existing` to re-issue (sliding refresh) while keeping the same
 * sid and absolute expiry.
 */
export async function createSession(
  response: NextResponse,
  uid: string,
  existing?: { sid: string; absExp: number },
): Promise<{ sid: string }> {
  const now = Date.now();
  const sid = existing?.sid ?? crypto.randomUUID();
  const absExp = existing?.absExp ?? now + ABSOLUTE_MS;
  const exp = Math.min(now + SLIDING_MS, absExp);
  const token = await signSession({ uid, sid, absExp, exp });
  response.cookies.set(
    sessionCookieName(),
    token,
    cookieOptions(Math.max(1, Math.floor((exp - now) / 1000))),
  );
  return { sid };
}

export function clearSession(response: NextResponse): void {
  response.cookies.set(sessionCookieName(), "", cookieOptions(0));
}

// --- Revocation (Redis, cached 30 s in server memory) ---

type RevocationEntry = { revoked: boolean; expiresAt: number };
const revocationCache = new Map<string, RevocationEntry>();

async function isRevoked(sid: string, uid: string, iatMs: number): Promise<
  | { state: "clear" }
  | { state: "revoked" }
  | { state: "unavailable" }
> {
  const cacheKey = `${sid}:${uid}`;
  const cached = revocationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { state: cached.revoked ? "revoked" : "clear" };
  }

  const result = await redisPipeline([
    ["GET", `revoked:${sid}`],
    ["GET", `validAfter:${uid}`],
  ]);
  if (result.state === "unconfigured") {
    // Revocation is unavailable without Redis; sessions rely on expiry.
    return { state: "clear" };
  }
  if (result.state === "unavailable") return { state: "unavailable" };

  const [revokedValue, validAfterValue] = result.results;
  const validAfter =
    typeof validAfterValue === "string" ? Number(validAfterValue) : NaN;
  const revoked =
    revokedValue != null || (Number.isFinite(validAfter) && iatMs < validAfter);
  revocationCache.set(cacheKey, {
    revoked,
    expiresAt: Date.now() + REVOCATION_CACHE_MS,
  });
  return { state: revoked ? "revoked" : "clear" };
}

/** Marks a single session id revoked until its absolute expiry. */
export async function revokeSession(sid: string, ttlMs: number): Promise<void> {
  const ttlSeconds = Math.max(60, Math.ceil(ttlMs / 1000));
  await redisPipeline([
    ["SET", `revoked:${sid}`, "1", "EX", String(ttlSeconds)],
  ]);
  for (const key of revocationCache.keys()) {
    if (key.startsWith(`${sid}:`)) revocationCache.delete(key);
  }
}

/** Invalidates every session issued for `uid` before now. */
export async function revokeAllSessionsForUser(uid: string): Promise<void> {
  await redisPipeline([
    ["SET", `validAfter:${uid}`, String(Date.now())],
  ]);
  for (const key of revocationCache.keys()) {
    if (key.endsWith(`:${uid}`)) revocationCache.delete(key);
  }
}

export async function requireSession(
  request: NextRequest,
): Promise<SessionResult> {
  const secret = sessionSecret();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      code: "SESSION_NOT_CONFIGURED",
      message: "Account sessions aren’t configured for this deployment.",
    };
  }

  const token =
    request.cookies.get(sessionCookieName())?.value ??
    request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: "SESSION_REQUIRED",
      message: "Sign in to continue.",
    };
  }

  let payload: {
    sub?: string;
    sid?: unknown;
    absExp?: unknown;
    iat?: number;
    exp?: number;
  };
  try {
    const verified = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    payload = verified.payload as typeof payload;
  } catch {
    return {
      ok: false,
      status: 401,
      code: "SESSION_INVALID",
      message: "Your session has expired. Sign in again.",
    };
  }

  const uid = payload.sub;
  const sid = payload.sid;
  const absExp = payload.absExp;
  if (
    typeof uid !== "string" ||
    typeof sid !== "string" ||
    typeof absExp !== "number" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return {
      ok: false,
      status: 401,
      code: "SESSION_INVALID",
      message: "Your session has expired. Sign in again.",
    };
  }

  const now = Date.now();
  if (absExp <= now) {
    return {
      ok: false,
      status: 401,
      code: "SESSION_EXPIRED",
      message: "Your session has expired. Sign in again.",
    };
  }

  const revocation = await isRevoked(sid, uid, payload.iat * 1000);
  if (revocation.state === "unavailable") {
    return {
      ok: false,
      status: 503,
      code: "SESSION_CHECK_UNAVAILABLE",
      message: "Sessions are temporarily unavailable. Please try again.",
    };
  }
  if (revocation.state === "revoked") {
    return {
      ok: false,
      status: 401,
      code: "SESSION_REVOKED",
      message: "This session has been signed out. Sign in again.",
    };
  }

  return {
    ok: true,
    uid,
    sid,
    absExp,
    shouldRefresh: payload.exp * 1000 - now < REFRESH_THRESHOLD_MS,
  };
}

/**
 * Re-issues the cookie on `response` when requireSession flagged the
 * session for a sliding refresh. Keeps the same sid and absolute expiry.
 */
export async function refreshSessionIfNeeded(
  response: NextResponse,
  session: Extract<SessionResult, { ok: true }>,
): Promise<void> {
  if (!session.shouldRefresh) return;
  await createSession(response, session.uid, {
    sid: session.sid,
    absExp: session.absExp,
  });
}

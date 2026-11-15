import { createHash } from "node:crypto";
import { limit } from "@/lib/server/limit";

// Single-window rate limiting for the auth routes.
//
// Phase 4: the core check now delegates to the unified limiter in
// lib/server/limit.ts (one Upstash pipeline, INCR + PEXPIRE = 2
// commands, fail-closed policy). Behaviour is unchanged from the
// original implementation:
// - Redis not configured: the check is skipped and the request is
//   allowed, with a warning logged — local development has no Upstash.
// - Redis configured but unreachable: the check fails closed
//   ("unavailable") and auth routes return 503, because these are
//   exactly the routes where failing open would invite credential
//   abuse.
// Keys here are passed through as-is (callers already hash IP/email
// parts with hashRateLimitKeyPart); limit() hashes the full key again
// before it reaches Redis, which only changes the stored key name,
// not the semantics.

export type WindowLimitResult =
  | { state: "allowed" }
  | { state: "limited"; retryAfter: number }
  | { state: "unavailable" };

export function hashRateLimitKeyPart(value: string): string {
  // Emails and IPs are never stored as raw Redis keys.
  return createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 32);
}

export async function checkWindowLimit(
  key: string,
  windowMs: number,
  max: number,
): Promise<WindowLimitResult> {
  const result = await limit(key, windowMs, max, "closed");
  if (result.state === "limited") {
    return { state: "limited", retryAfter: result.retryAfter ?? Math.max(1, Math.ceil(windowMs / 1000)) };
  }
  if (result.state === "unavailable") return { state: "unavailable" };
  // "ok" and "skipped" (Redis unconfigured) both allow, as before.
  return { state: "allowed" };
}

/** Checks several windows in order; stops at the first limit hit. */
export async function checkWindowLimits(
  limits: { key: string; windowMs: number; max: number }[],
): Promise<WindowLimitResult> {
  for (const limit of limits) {
    const result = await checkWindowLimit(limit.key, limit.windowMs, limit.max);
    if (result.state !== "allowed") return result;
  }
  return { state: "allowed" };
}

export function rateLimitedResponse(
  result: Extract<WindowLimitResult, { state: "limited" | "unavailable" }>,
): { status: 429 | 503; code: string; message: string; retryAfter?: number } {
  if (result.state === "limited") {
    return {
      status: 429,
      code: "RATE_LIMITED",
      message: "There have been too many attempts. Wait a little while, then try again.",
      retryAfter: result.retryAfter,
    };
  }
  return {
    status: 503,
    code: "RATE_LIMIT_UNAVAILABLE",
    message: "Sign-in protection is temporarily unavailable. Please try again.",
  };
}

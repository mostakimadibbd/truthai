import { createHash } from "node:crypto";
import { redisPipeline } from "@/lib/server/redis";

// Unified single-window rate limiter (Phase 4). One Upstash pipeline
// per check — INCR + PEXPIRE = 2 commands — with the caller's key
// hashed before it reaches Redis, so emails, IPs and uids are never
// stored as raw key material.
//
// Policies:
//  - "closed" (auth, destructive and write routes): when Redis is
//    configured but unreachable, the request is DENIED
//    (state "unavailable" → routes answer 503).
//  - "open" (cheap reads): the same failure only logs a warning and
//    the request is allowed.
// When Redis is not configured at all (local development), both
// policies allow with a warning — that mirrors the Phase 1 auth
// limiter and keeps `next dev` usable without Upstash. Production
// deployments are expected to configure Upstash; SECURITY.md says so.
//
// resetAt is an upper-bound estimate: the window is anchored at the
// first increment, so the true reset is at or before
// now + windowMs. (Reading the real TTL would cost a third command
// per check, which the free-tier command budget does not allow.)

export type LimitPolicy = "closed" | "open";

export type LimitResult = {
  allowed: boolean;
  remaining: number;
  /** Upper-bound epoch ms at which the current window resets. */
  resetAt: number;
  state: "ok" | "limited" | "unavailable" | "skipped";
  /** Seconds to wait before retrying (only when state is "limited"). */
  retryAfter?: number;
};

export async function limit(
  key: string,
  windowMs: number,
  max: number,
  policy: LimitPolicy,
): Promise<LimitResult> {
  const hashedKey = `xyro:limit:${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
  const resetAt = Date.now() + windowMs;

  const result = await redisPipeline([
    ["INCR", hashedKey],
    ["PEXPIRE", hashedKey, String(windowMs), "NX"],
  ]);

  if (result.state === "unconfigured") {
    console.warn(
      "Rate limiting is not configured (Upstash missing); allowing request.",
    );
    return { allowed: true, remaining: max, resetAt, state: "skipped" };
  }
  if (result.state === "unavailable") {
    if (policy === "open") {
      console.warn(
        "Rate limiting is unavailable; allowing a read request (fail-open policy).",
      );
      return { allowed: true, remaining: max, resetAt, state: "unavailable" };
    }
    return { allowed: false, remaining: 0, resetAt, state: "unavailable" };
  }

  const count = result.results[0];
  if (typeof count !== "number") {
    if (policy === "open") {
      console.warn("Rate limiter returned an unexpected result; allowing read.");
      return { allowed: true, remaining: max, resetAt, state: "unavailable" };
    }
    return { allowed: false, remaining: 0, resetAt, state: "unavailable" };
  }

  if (count > max) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      state: "limited",
      retryAfter: Math.max(1, Math.ceil(windowMs / 1000)),
    };
  }
  return {
    allowed: true,
    remaining: Math.max(0, max - count),
    resetAt,
    state: "ok",
  };
}

/** One-line route wrapper around limit(). */
export async function enforceLimit(
  key: string,
  windowMs: number,
  max: number,
  policy: LimitPolicy,
): Promise<LimitResult> {
  return limit(key, windowMs, max, policy);
}

export function limitDeniedResponse(result: LimitResult): {
  status: 429 | 503;
  code: string;
  message: string;
  retryAfter?: number;
} {
  if (result.state === "limited") {
    return {
      status: 429,
      code: "RATE_LIMITED",
      message: "There have been too many requests. Wait a little while, then try again.",
      retryAfter: result.retryAfter,
    };
  }
  return {
    status: 503,
    code: "RATE_LIMIT_UNAVAILABLE",
    message: "Request protection is temporarily unavailable. Please try again.",
  };
}

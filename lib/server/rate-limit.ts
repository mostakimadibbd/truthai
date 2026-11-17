import { serverEnv } from "./env";
const RATE_LIMIT_SCRIPT = `
local minuteCount = redis.call('INCR', KEYS[1])
if minuteCount == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local dayCount = redis.call('INCR', KEYS[2])
if dayCount == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[2]) end
return {minuteCount, dayCount, redis.call('PTTL', KEYS[1]), redis.call('PTTL', KEYS[2])}
`;

export type RateLimitResult =
  | { state: "allowed" }
  | { state: "limited"; retryAfter: number }
  | { state: "unavailable" };

export type UsagePeek = {
  state: "ok" | "unconfigured" | "unavailable";
  minuteCount: number;
  dayCount: number;
  /** Epoch ms when the daily counter resets (null when unknown). */
  dayResetAt: number | null;
};

/**
 * Read-only view of the counters written by checkRateLimit — used by
 * GET /api/usage. Issues GET + PTTL for the minute and day keys in one
 * pipeline (4 commands, no INCR), so checking usage never consumes it.
 * Keys must match checkRateLimit exactly: xyro:{feature}:{uid}:minute
 * and xyro:{feature}:{uid}:day (the Lua script sets a 60 s / 24 h TTL
 * on first increment, which anchors the windows).
 */
export async function peekRateLimitUsage(
  uid: string,
  feature: "chat" | "upload",
): Promise<UsagePeek> {
  const { redisPipeline } = await import("@/lib/server/redis");
  const result = await redisPipeline([
    ["GET", `xyro:${feature}:${uid}:minute`],
    ["GET", `xyro:${feature}:${uid}:day`],
    ["PTTL", `xyro:${feature}:${uid}:day`],
  ]);
  if (result.state !== "ok") {
    return {
      state: result.state,
      minuteCount: 0,
      dayCount: 0,
      dayResetAt: null,
    };
  }
  const [minuteRaw, dayRaw, dayTtl] = result.results;
  const toCount = (value: unknown) => {
    const parsed = typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  };
  return {
    state: "ok",
    minuteCount: toCount(minuteRaw),
    dayCount: toCount(dayRaw),
    dayResetAt:
      typeof dayTtl === "number" && dayTtl > 0 ? Date.now() + dayTtl : null,
  };
}

export async function checkRateLimit(
  uid: string,
  feature: "chat" | "upload",
  perMinute: number,
  perDay: number,
): Promise<RateLimitResult> {
  const redisUrl = serverEnv.upstashRedisUrl;
  const redisToken = serverEnv.upstashRedisToken;
  if (!redisUrl || !redisToken) return { state: "unavailable" };

  try {
    const response = await fetch(redisUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        "EVAL",
        RATE_LIMIT_SCRIPT,
        "2",
        `xyro:${feature}:${uid}:minute`,
        `xyro:${feature}:${uid}:day`,
        "60000",
        "86400000",
      ]),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { state: "unavailable" };
    const result: unknown = await response.json();
    if (
      typeof result !== "object" ||
      result === null ||
      !("result" in result) ||
      !Array.isArray(result.result) ||
      result.result.length !== 4 ||
      result.result.some((value) => typeof value !== "number")
    ) {
      return { state: "unavailable" };
    }

    const [minuteCount, dayCount, minuteTtl, dayTtl] = result.result;
    if (dayCount > perDay) {
      return { state: "limited", retryAfter: Math.max(1, Math.ceil(dayTtl / 1000)) };
    }
    if (minuteCount > perMinute) {
      return { state: "limited", retryAfter: Math.max(1, Math.ceil(minuteTtl / 1000)) };
    }
    return { state: "allowed" };
  } catch {
    return { state: "unavailable" };
  }
}

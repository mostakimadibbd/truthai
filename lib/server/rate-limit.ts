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

export async function checkRateLimit(
  uid: string,
  feature: "chat" | "upload",
  perMinute: number,
  perDay: number,
): Promise<RateLimitResult> {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
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

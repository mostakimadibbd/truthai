// Minimal Upstash Redis REST helper shared by the session and auth
// rate-limit code. Uses the pipeline endpoint so several commands travel
// in a single HTTP request; callers are responsible for keeping the
// command count per user request within the free-tier budget.

export type RedisPipelineResult =
  | { state: "ok"; results: unknown[] }
  | { state: "unconfigured" }
  | { state: "unavailable" };

export function isRedisConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

export async function redisPipeline(
  commands: string[][],
): Promise<RedisPipelineResult> {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return { state: "unconfigured" };

  try {
    const response = await fetch(`${redisUrl}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { state: "unavailable" };
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) return { state: "unavailable" };
    const results = payload.map((entry) =>
      typeof entry === "object" && entry !== null && "result" in entry
        ? (entry as { result: unknown }).result
        : undefined,
    );
    return { state: "ok", results };
  } catch {
    return { state: "unavailable" };
  }
}

import { serverEnv } from "@/lib/server/env";

/**
 * Cloudflare Workers AI liveness probe (for /api/health): presence
 * of the env pair is not proof the token works — the token must
 * carry the Workers AI permission and the account id must match.
 * This calls the account's model-search endpoint (a cheap read)
 * and reports only a coarse outcome; no credential material ever
 * leaves the process.
 */
export type CloudflareLiveResult = {
  configured: boolean;
  live: boolean;
  errorKind:
    | "not_configured"
    | "invalid_token"
    | "account_not_found"
    | "cloudflare_unavailable"
    | "network"
    | "unknown"
    | null;
};

export async function checkCloudflareLive(): Promise<CloudflareLiveResult> {
  const accountId = serverEnv.cloudflareAccountId;
  const apiToken = serverEnv.cloudflareApiToken;
  if (!accountId || !apiToken) {
    return { configured: false, live: false, errorKind: "not_configured" };
  }
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${apiToken}` },
        signal: AbortSignal.timeout(6_000),
      },
    );
    if (response.ok) return { configured: true, live: true, errorKind: null };
    if (response.status === 401 || response.status === 403) {
      return { configured: true, live: false, errorKind: "invalid_token" };
    }
    if (response.status === 404) {
      return { configured: true, live: false, errorKind: "account_not_found" };
    }
    return { configured: true, live: false, errorKind: "cloudflare_unavailable" };
  } catch {
    return { configured: true, live: false, errorKind: "network" };
  }
}

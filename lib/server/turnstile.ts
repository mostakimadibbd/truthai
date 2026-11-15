import { siteUrl } from "@/lib/site";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const TURNSTILE_ACTIONS = [
  "sign_in",
  "create_account",
  "reset_password",
  "session_refresh",
] as const;

export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[number];

export type TurnstileVerification =
  | { state: "valid" }
  | { state: "invalid"; reason: string }
  | { state: "unavailable" }
  | { state: "misconfigured" };

// Cloudflare's published test secrets (see the Turnstile testing docs).
// 1x… always passes, 2x… always fails, 3x… always returns
// timeout-or-duplicate ("token already spent"). Test responses carry
// fixed metadata (hostname "localhost", a placeholder action), so the
// action/hostname checks below cannot be applied to them outside
// production. In production a test secret is a misconfiguration.
const TEST_SECRETS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

function isProduction(): boolean {
  // Per the product spec, "production" means VERCEL_ENV === "production".
  // Vercel always sets VERCEL_ENV (production / preview / development),
  // so production deployments are covered; local runs (VERCEL_ENV unset)
  // count as non-production and may use the test secrets.
  return process.env.VERCEL_ENV === "production";
}

function allowedHostnames(): Set<string> {
  const hosts = new Set<string>();
  try {
    hosts.add(new URL(siteUrl).hostname.toLowerCase());
  } catch {
    // lib/site already validates SITE_URL at import time; this is only a
    // guard against unexpected runtime values.
  }
  // The stable vercel.app alias for this deployment, when known.
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelUrl) hosts.add(vercelUrl.replace(/^https?:\/\//, "").toLowerCase());
  // Extra custom domains, comma-separated, e.g. "app.example.com,example.com".
  const extra = process.env.TURNSTILE_HOSTNAME_ALLOWLIST ?? "";
  for (const host of extra.split(",")) {
    const trimmed = host.trim().toLowerCase();
    if (trimmed) hosts.add(trimmed);
  }
  return hosts;
}

function hostnameAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (allowedHostnames().has(host)) return true;
  // Any subdomain of vercel.app counts as the deployment alias (preview
  // URLs are per-deployment subdomains).
  return host === "vercel.app" || host.endsWith(".vercel.app");
}

type SiteverifyResult = {
  success?: unknown;
  action?: unknown;
  hostname?: unknown;
  "error-codes"?: unknown;
};

export async function verifyTurnstile(
  token: string,
  options: { expectedAction: TurnstileAction; remoteIp?: string },
): Promise<TurnstileVerification> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return { state: "misconfigured" };

  const isTestSecret = TEST_SECRETS.has(secret);
  if (isTestSecret && isProduction()) return { state: "misconfigured" };

  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    return { state: "invalid", reason: "Complete the security check and try again." };
  }

  const form = new URLSearchParams({
    secret,
    response: token,
    idempotency_key: crypto.randomUUID(),
  });
  if (options.remoteIp) form.set("remoteip", options.remoteIp);

  let response: Response;
  try {
    response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return { state: "unavailable" };
  }
  if (!response.ok) return { state: "unavailable" };

  let result: SiteverifyResult;
  try {
    result = (await response.json()) as SiteverifyResult;
  } catch {
    return { state: "unavailable" };
  }
  if (typeof result !== "object" || result === null || !("success" in result)) {
    return { state: "unavailable" };
  }

  // Never log the token or the secret; error codes are safe to inspect.
  const errorCodes = Array.isArray(result["error-codes"])
    ? result["error-codes"].filter((code): code is string => typeof code === "string")
    : [];
  if (
    errorCodes.includes("missing-input-secret") ||
    errorCodes.includes("invalid-input-secret")
  ) {
    return { state: "misconfigured" };
  }

  if (result.success !== true) {
    if (errorCodes.includes("timeout-or-duplicate")) {
      return { state: "invalid", reason: "The check expired, try again" };
    }
    return {
      state: "invalid",
      reason: "The security check failed. Please try again.",
    };
  }

  // Test-mode responses carry fixed metadata, so action/hostname cannot
  // be checked against them outside production.
  if (isTestSecret) return { state: "valid" };

  if (result.action !== options.expectedAction) {
    return {
      state: "invalid",
      reason: "The security check failed. Please try again.",
    };
  }
  if (typeof result.hostname !== "string" || !hostnameAllowed(result.hostname)) {
    return {
      state: "invalid",
      reason: "The security check failed. Please try again.",
    };
  }
  return { state: "valid" };
}

/** First IP of the x-forwarded-for chain, when present and plausible. */
export function getRemoteIp(request: { headers: Headers }): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first && first.length <= 45 && /^[0-9a-fA-F:.]+$/.test(first)) return first;
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp && realIp.length <= 45 && /^[0-9a-fA-F:.]+$/.test(realIp)) return realIp;
  return undefined;
}

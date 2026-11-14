const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SIGN_UP_ACTION = "create_account";

export type TurnstileVerification =
  | { state: "valid" }
  | { state: "invalid" }
  | { state: "unavailable" }
  | { state: "misconfigured" };

export async function verifyTurnstileToken(
  token: string,
  hostname: string,
): Promise<TurnstileVerification> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return { state: "misconfigured" };

  let response: Response;
  try {
    response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        response: token,
        idempotency_key: crypto.randomUUID(),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { state: "unavailable" };
  }
  if (!response.ok) return { state: "unavailable" };

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    return { state: "unavailable" };
  }
  if (typeof result !== "object" || result === null || !("success" in result)) {
    return { state: "unavailable" };
  }
  if (result.success !== true) return { state: "invalid" };

  return "action" in result &&
    result.action === SIGN_UP_ACTION &&
    "hostname" in result &&
    typeof result.hostname === "string" &&
    result.hostname.toLowerCase() === hostname.toLowerCase()
    ? { state: "valid" }
    : { state: "invalid" };
}

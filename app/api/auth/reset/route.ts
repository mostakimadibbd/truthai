import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  guardAuthPost,
  stringField,
} from "@/lib/server/auth-guard";
import {
  checkWindowLimits,
  hashRateLimitKeyPart,
  rateLimitedResponse,
} from "@/lib/server/auth-rate-limit";
import { sendOobCodeServer } from "@/lib/server/identity-toolkit";
import { getRemoteIp, verifyTurnstile } from "@/lib/server/turnstile";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 4096;
const GENERIC_SUCCESS =
  "If an account exists for this address, a password reset email has been sent.";

// Password reset is requested through the server so Turnstile can gate
// it. The response is always the same generic success message (unless
// the request itself is malformed or rate-limited), so it never reveals
// whether an account exists.
export async function POST(request: NextRequest) {
  const guarded = await guardAuthPost(request, MAX_BODY_BYTES);
  if (!guarded.ok) return guarded.response;
  const { body } = guarded;

  const email = stringField(body, "email")?.trim() ?? "";
  const turnstileToken = stringField(body, "turnstileToken") ?? "";
  if (email.length === 0 || email.length > 254 || turnstileToken.length === 0) {
    return authErrorResponse(
      400,
      "INVALID_RESET",
      "Enter your email address and complete the security check.",
    );
  }

  const remoteIp = getRemoteIp(request);
  const rateLimit = await checkWindowLimits([
    {
      key: `xyro:auth:reset:ip-email:${hashRateLimitKeyPart(`${remoteIp ?? "unknown"}:${email}`)}`,
      windowMs: 60 * 60 * 1000,
      max: 3,
    },
  ]);
  if (rateLimit.state !== "allowed") {
    const limited = rateLimitedResponse(rateLimit);
    return authErrorResponse(limited.status, limited.code, limited.message, {
      ...(limited.retryAfter
        ? { "Retry-After": String(limited.retryAfter) }
        : {}),
    });
  }

  const verification = await verifyTurnstile(turnstileToken, {
    expectedAction: "reset_password",
    remoteIp,
  });
  if (verification.state === "misconfigured") {
    return authErrorResponse(503, "TURNSTILE_NOT_CONFIGURED", "Account security verification isn’t configured.");
  }
  if (verification.state === "unavailable") {
    return authErrorResponse(503, "TURNSTILE_UNAVAILABLE", "Security verification is temporarily unavailable.");
  }
  if (verification.state === "invalid") {
    return authErrorResponse(403, "TURNSTILE_INVALID", verification.reason);
  }

  const result = await sendOobCodeServer({
    requestType: "PASSWORD_RESET",
    email,
  });
  if (result.state === "misconfigured") {
    return authErrorResponse(503, "RESET_NOT_CONFIGURED", "Password reset isn’t configured for this deployment.");
  }
  // Even when Firebase reports the address as unknown, the caller sees
  // the same generic success — no account enumeration.
  return NextResponse.json(
    { success: true, message: GENERIC_SUCCESS },
    { headers: { "Cache-Control": "no-store" } },
  );
}

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
import { getFirebaseAdminAuth } from "@/lib/server/firebase-admin";
import { signInWithPasswordServer } from "@/lib/server/identity-toolkit";
import { createSession, isSessionConfigured } from "@/lib/server/session";
import { recordSessionLogin } from "@/lib/server/session-record";
import { getRemoteIp, verifyTurnstile } from "@/lib/server/turnstile";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 16_384;

// Email/password sign-in happens on the server: the Turnstile token is
// verified first, then the server calls Identity Toolkit
// accounts:signInWithPassword. Only on success does the client receive
// a Firebase custom token plus the Turnstile-gated session cookie.
export async function POST(request: NextRequest) {
  const guarded = await guardAuthPost(request, MAX_BODY_BYTES);
  if (!guarded.ok) return guarded.response;
  const { body } = guarded;

  const email = stringField(body, "email")?.trim() ?? "";
  const password = stringField(body, "password") ?? "";
  const turnstileToken = stringField(body, "turnstileToken") ?? "";
  const deviceId = stringField(body, "deviceId") ?? undefined;
  if (
    email.length === 0 ||
    email.length > 254 ||
    password.length === 0 ||
    password.length > 1024 ||
    turnstileToken.length === 0
  ) {
    return authErrorResponse(
      400,
      "INVALID_SIGN_IN",
      "Enter your email and password, and complete the security check.",
    );
  }

  if (!isSessionConfigured()) {
    return authErrorResponse(
      503,
      "SESSION_NOT_CONFIGURED",
      "Account sessions aren’t configured for this deployment.",
    );
  }

  const remoteIp = getRemoteIp(request);
  const rateLimit = await checkWindowLimits([
    {
      key: `xyro:auth:sign-in:ip-email:${hashRateLimitKeyPart(`${remoteIp ?? "unknown"}:${email}`)}`,
      windowMs: 10 * 60 * 1000,
      max: 8,
    },
    {
      key: `xyro:auth:sign-in:ip:${hashRateLimitKeyPart(remoteIp ?? "unknown")}`,
      windowMs: 60 * 60 * 1000,
      max: 30,
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
    expectedAction: "sign_in",
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

  const signIn = await signInWithPasswordServer(email, password);
  if (signIn.state === "misconfigured") {
    return authErrorResponse(503, "SIGN_IN_NOT_CONFIGURED", "Sign-in isn’t configured for this deployment.");
  }
  if (signIn.state === "unavailable") {
    return authErrorResponse(503, "SIGN_IN_UNAVAILABLE", "Sign-in is temporarily unavailable. Please try again.");
  }
  if (signIn.state === "too_many_attempts") {
    return authErrorResponse(
      429,
      "TOO_MANY_ATTEMPTS",
      "There have been too many sign-in attempts for this account. Wait a little while, then try again.",
      { "Retry-After": "600" },
    );
  }
  if (signIn.state === "disabled") {
    return authErrorResponse(403, "ACCOUNT_DISABLED", "This account is disabled. Contact the site administrator for help.");
  }
  if (signIn.state === "invalid_credentials") {
    // One generic error for wrong email and wrong password alike, so
    // the response never reveals whether an account exists.
    return authErrorResponse(401, "INVALID_CREDENTIALS", "That email and password don’t match. Check them and try again.");
  }

  let adminAuth: ReturnType<typeof getFirebaseAdminAuth>;
  try {
    adminAuth = getFirebaseAdminAuth();
  } catch (error) {
    console.error("Firebase Admin sign-in is not configured.", error);
    return authErrorResponse(503, "SIGN_IN_NOT_CONFIGURED", "Sign-in isn’t configured for this deployment.");
  }

  try {
    const user = await adminAuth.getUser(signIn.uid);
    if (user.disabled) {
      return authErrorResponse(403, "ACCOUNT_DISABLED", "This account is disabled. Contact the site administrator for help.");
    }
    const customToken = await adminAuth.createCustomToken(signIn.uid);
    const response = NextResponse.json(
      { customToken },
      { headers: { "Cache-Control": "no-store" } },
    );
    const { sid } = await createSession(response, signIn.uid);
    await recordSessionLogin(signIn.uid, sid, request, {
      deviceId,
      eventType: "sign_in",
    });
    return response;
  } catch (error) {
    console.error("Firebase sign-in session creation failed.", error);
    return authErrorResponse(503, "SIGN_IN_FAILED", "We couldn’t start your session right now. Please try again.");
  }
}

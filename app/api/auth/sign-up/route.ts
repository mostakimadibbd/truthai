import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse as errorResponse,
  guardAuthPost,
  stringField,
} from "@/lib/server/auth-guard";
import {
  checkWindowLimit,
  hashRateLimitKeyPart,
  rateLimitedResponse,
} from "@/lib/server/auth-rate-limit";
import {
  getFirebaseAdminAuth,
  getFirebaseAdminFirestore,
} from "@/lib/server/firebase-admin";
import { checkPasswordNotBreached } from "@/lib/server/password";
import { passwordUnmetMessage } from "@/lib/password-rules";
import { createSession, isSessionConfigured } from "@/lib/server/session";
import { getDeviceContext } from "@/lib/server/device";
import {
  recordDeviceSignUp,
  recordSecurityEvent,
  recordSessionLogin,
} from "@/lib/server/session-record";
import { getRemoteIp, verifyTurnstile } from "@/lib/server/turnstile";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 16_384;
const MAX_PASSWORD_LENGTH = 1024;

function getErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

export async function POST(request: NextRequest) {
  const guarded = await guardAuthPost(request, MAX_BODY_BYTES);
  if (!guarded.ok) return guarded.response;
  const { body } = guarded;

  const email = stringField(body, "email")?.trim() ?? "";
  const password = stringField(body, "password") ?? "";
  const displayName = stringField(body, "displayName") ?? "";
  const turnstileToken = stringField(body, "turnstileToken") ?? "";
  const deviceId = stringField(body, "deviceId") ?? undefined;
  if (
    email.length === 0 ||
    email.length > 254 ||
    password.length < 10 ||
    password.length > MAX_PASSWORD_LENGTH ||
    body.termsAccepted !== true ||
    displayName.length > 100 ||
    turnstileToken.length === 0 ||
    turnstileToken.length > 2048
  ) {
    return errorResponse(400, "INVALID_SIGN_UP", "Check the name, email, password, and security check.");
  }

  // Composition rules (shared with the form's live checklist):
  // length + lowercase + uppercase + symbol are all mandatory.
  const unmetPassword = passwordUnmetMessage(password);
  if (unmetPassword) {
    return errorResponse(400, "PASSWORD_RULES", unmetPassword);
  }

  if (!isSessionConfigured()) {
    return errorResponse(503, "SESSION_NOT_CONFIGURED", "Account sessions aren’t configured for this deployment.");
  }

  // Phase 4 audit addition: account creation had no IP limit. Cap
  // sign-up attempts at 10 per hour per IP (fail closed), before the
  // Turnstile and Admin work below.
  const signUpLimit = await checkWindowLimit(
    `xyro:auth:sign-up:ip:${hashRateLimitKeyPart(getRemoteIp(request) ?? "unknown")}`,
    60 * 60 * 1000,
    10,
  );
  if (signUpLimit.state !== "allowed") {
    const limited = rateLimitedResponse(signUpLimit);
    return errorResponse(limited.status, limited.code, limited.message, {
      ...(limited.retryAfter
        ? { "Retry-After": String(limited.retryAfter) }
        : {}),
    });
  }

  const verification = await verifyTurnstile(turnstileToken, {
    expectedAction: "create_account",
    remoteIp: getRemoteIp(request),
  });
  if (verification.state === "misconfigured") {
    return errorResponse(503, "TURNSTILE_NOT_CONFIGURED", "Account security verification isn’t configured.");
  }
  if (verification.state === "unavailable") {
    return errorResponse(503, "TURNSTILE_UNAVAILABLE", "Security verification is temporarily unavailable.");
  }
  if (verification.state === "invalid") {
    return errorResponse(403, "TURNSTILE_INVALID", verification.reason);
  }

  const passwordCheck = await checkPasswordNotBreached(password);
  if (passwordCheck.state === "breached") {
    return errorResponse(400, "PASSWORD_BREACHED", "This password appears in known data breaches. Please choose another one.");
  }
  if (passwordCheck.state === "unavailable") {
    // Fail open with a stricter rule: if the breach-check service is
    // down, sign-up still works but the password must be 12+ characters.
    if (password.length < 12) {
      return errorResponse(
        400,
        "PASSWORD_TOO_SHORT_WHILE_CHECK_UNAVAILABLE",
        "Our password safety check is unavailable right now, so please choose a password with at least 12 characters.",
      );
    }
    console.warn(
      "Breach-check service unavailable during sign-up; allowing a 12+ character password.",
    );
  }

  let adminAuth: ReturnType<typeof getFirebaseAdminAuth>;
  try {
    adminAuth = getFirebaseAdminAuth();
  } catch (error) {
    console.error("Firebase Admin sign-up is not configured.", error);
    return errorResponse(503, "SIGN_UP_NOT_CONFIGURED", "Account creation isn’t configured for this deployment.");
  }

  let user;
  try {
    user = await adminAuth.createUser({
      email,
      password,
      displayName: displayName.trim() || undefined,
    });
  } catch (error) {
    const code = getErrorCode(error);
    if (code === "auth/email-already-exists") {
      return errorResponse(409, "EMAIL_IN_USE", "An account already uses this email. Sign in instead.");
    }
    if (code === "auth/invalid-email" || code === "auth/invalid-password") {
      return errorResponse(400, "INVALID_SIGN_UP", "Check your email address and password, then try again.");
    }
    console.error("Firebase account creation failed.", error);
    return errorResponse(503, "ACCOUNT_CREATION_FAILED", "We couldn’t create your account right now. Please try again.");
  }

  // Create the profile server-side so the account is complete even if
  // the browser closes right after sign-up.
  try {
    await getFirebaseAdminFirestore()
      .collection("users")
      .doc(user.uid)
      .set(
        {
          uid: user.uid,
          email,
          displayName: displayName.trim(),
          photoURL: "",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          lastSignInAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  } catch (error) {
    console.error("Server profile creation failed after sign-up.", error);
  }

  try {
    const customToken = await adminAuth.createCustomToken(user.uid);
    const response = NextResponse.json(
      { customToken },
      { headers: { "Cache-Control": "no-store" } },
    );
    // The session cookie is minted in the same response as the custom
    // token, so a created account is immediately a Turnstile-gated
    // session.
    const { sid } = await createSession(response, user.uid);
    await recordSessionLogin(user.uid, sid, request, {
      deviceId,
      eventType: "sign_up",
    });
    // Sign-up velocity signal: many accounts from one device is an
    // abuse indicator worth an activity entry (never a block — shared
    // devices are legitimate).
    const deviceContext = getDeviceContext(request, deviceId);
    const velocity = await recordDeviceSignUp(deviceContext.deviceId, user.uid);
    if (velocity.flagged) {
      await recordSecurityEvent(user.uid, {
        type: "device_velocity",
        context: deviceContext,
      });
    }
    return response;
  } catch (error) {
    console.error("Firebase custom token creation failed after account creation.", error);
    return errorResponse(
      503,
      "ACCOUNT_CREATED_SIGN_IN_FAILED",
      "Your account was created, but we couldn’t start its session. Sign in with your new credentials.",
    );
  }
}

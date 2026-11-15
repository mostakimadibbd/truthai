import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  guardAuthPost,
  stringField,
} from "@/lib/server/auth-guard";
import { authenticateSessionUser } from "@/lib/server/api-auth";
import {
  checkWindowLimit,
  rateLimitedResponse,
} from "@/lib/server/auth-rate-limit";
import { getFirebaseAdminAuth } from "@/lib/server/firebase-admin";
import { signInWithPasswordServer } from "@/lib/server/identity-toolkit";
import { checkPasswordNotBreached } from "@/lib/server/password";
import { passwordUnmetMessage } from "@/lib/password-rules";
import { revokeSession } from "@/lib/server/session";
import {
  deleteSessionRecord,
  listSessionRecords,
} from "@/lib/server/session-record";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 4096;
const SESSION_ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000;

// Change password for email/password accounts.
//
// Flow: re-authenticate with the current password (server-side
// Identity Toolkit, so the check is Turnstile-session-gated), enforce
// the same breached-password rule as sign-up (min 10 characters; if
// the breach service is down, fail open at 12+ like sign-up does),
// then update the password with the Admin SDK.
//
// Session handling (design decision): other sessions are revoked
// individually — every recorded sid except the current one gets a
// Redis revoked:{sid} flag and its Settings record is deleted — while
// the current device keeps its exact session (same sid, same cookie).
// validAfter:{uid} and Admin revokeRefreshTokens are deliberately NOT
// used here: both would also kill the current device (validAfter
// invalidates every session issued before now, including this one;
// revokeRefreshTokens signs the current browser out of Firebase on its
// next token refresh). Per-sid revocation is precise: other devices
// lose API access immediately, this device is untouched.
export async function POST(request: NextRequest) {
  const guarded = await guardAuthPost(request, MAX_BODY_BYTES);
  if (!guarded.ok) return guarded.response;

  const currentPassword = stringField(guarded.body, "currentPassword") ?? "";
  const newPassword = stringField(guarded.body, "newPassword") ?? "";
  if (
    currentPassword.length === 0 ||
    currentPassword.length > 1024 ||
    newPassword.length < 10 ||
    newPassword.length > 1024
  ) {
    return authErrorResponse(
      400,
      "INVALID_PASSWORD",
      "Enter your current password and a new password of at least 10 characters.",
    );
  }
  if (newPassword === currentPassword) {
    return authErrorResponse(
      400,
      "PASSWORD_UNCHANGED",
      "Choose a new password that’s different from your current one.",
    );
  }
  const unmetPassword = passwordUnmetMessage(newPassword);
  if (unmetPassword) {
    return authErrorResponse(400, "PASSWORD_RULES", unmetPassword);
  }

  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }
  if (!auth.email) {
    return authErrorResponse(400, "EMAIL_REQUIRED", "This account has no email address.");
  }

  const rateLimit = await checkWindowLimit(
    `xyro:account:change-password:user:${auth.uid}`,
    60 * 60 * 1000,
    5,
  );
  if (rateLimit.state !== "allowed") {
    const limited = rateLimitedResponse(rateLimit);
    return authErrorResponse(limited.status, limited.code, limited.message, {
      ...(limited.retryAfter
        ? { "Retry-After": String(limited.retryAfter) }
        : {}),
    });
  }

  let adminAuth: ReturnType<typeof getFirebaseAdminAuth>;
  try {
    adminAuth = getFirebaseAdminAuth();
  } catch (error) {
    console.error("Firebase Admin change-password is not configured.", error);
    return authErrorResponse(503, "AUTH_NOT_CONFIGURED", "Account services aren’t configured for this deployment.");
  }

  let user: Awaited<ReturnType<typeof adminAuth.getUser>>;
  try {
    user = await adminAuth.getUser(auth.uid);
  } catch (error) {
    console.error("Firebase user lookup failed for change-password.", error);
    return authErrorResponse(503, "PASSWORD_CHANGE_FAILED", "We couldn’t change your password right now. Please try again.");
  }
  const hasPassword = user.providerData.some(
    (provider) => provider.providerId === "password",
  );
  if (!hasPassword) {
    return authErrorResponse(
      400,
      "GOOGLE_ONLY_ACCOUNT",
      "This account signs in with Google, so there’s no Xyro AI password to change. Manage your password in your Google account.",
    );
  }

  const reauth = await signInWithPasswordServer(auth.email, currentPassword);
  if (reauth.state === "invalid_credentials") {
    return authErrorResponse(401, "CURRENT_PASSWORD_INCORRECT", "Your current password is incorrect.");
  }
  if (reauth.state === "too_many_attempts") {
    return authErrorResponse(429, "RATE_LIMITED", "Too many attempts. Wait a little while, then try again.");
  }
  if (reauth.state === "disabled") {
    return authErrorResponse(403, "ACCOUNT_DISABLED", "This account is disabled.");
  }
  if (reauth.state !== "ok" || reauth.uid !== auth.uid) {
    return authErrorResponse(503, "REAUTH_UNAVAILABLE", "We couldn’t verify your current password right now. Please try again.");
  }

  const breach = await checkPasswordNotBreached(newPassword);
  if (breach.state === "breached") {
    return authErrorResponse(400, "PASSWORD_BREACHED", "This password appears in known data breaches. Please choose another one.");
  }
  if (breach.state === "unavailable" && newPassword.length < 12) {
    return authErrorResponse(
      400,
      "PASSWORD_TOO_SHORT_WHILE_CHECK_UNAVAILABLE",
      "Our password safety check is unavailable right now, so please choose a password with at least 12 characters.",
    );
  }

  try {
    await adminAuth.updateUser(auth.uid, { password: newPassword });
  } catch (error) {
    console.error("Firebase password update failed.", error);
    return authErrorResponse(503, "PASSWORD_CHANGE_FAILED", "We couldn’t change your password right now. Please try again.");
  }

  // Revoke every OTHER recorded session; keep this device signed in.
  try {
    const records = await listSessionRecords(auth.uid, auth.sid);
    for (const record of records) {
      if (record.sid === auth.sid) continue;
      await revokeSession(record.sid, SESSION_ABSOLUTE_MS);
      await deleteSessionRecord(auth.uid, record.sid);
    }
  } catch (error) {
    // The password itself is changed; a cleanup failure is logged and
    // the user is told other sessions may need a manual sign-out.
    console.error("Couldn’t revoke other sessions after password change.", error);
    return NextResponse.json(
      {
        success: true,
        otherSessionsRevoked: false,
        warning:
          "Your password was changed, but other devices couldn’t be signed out automatically. Use “Sign out of all other devices” in Settings → Security.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { success: true, otherSessionsRevoked: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

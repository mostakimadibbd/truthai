import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  guardAuthPost,
  stringField,
} from "@/lib/server/auth-guard";
import {
  checkWindowLimit,
  rateLimitedResponse,
} from "@/lib/server/auth-rate-limit";
import { getFirebaseAdminAuth } from "@/lib/server/firebase-admin";
import { sendOobCodeServer } from "@/lib/server/identity-toolkit";
import { requireSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 16_384;

// Resending the verification email requires an established session (the
// user just signed up or signed in) plus their Firebase ID token, and
// is limited to one send per 60 seconds per user. The email itself is
// sent by Firebase via a server-side accounts:sendOobCode call.
export async function POST(request: NextRequest) {
  const guarded = await guardAuthPost(request, MAX_BODY_BYTES);
  if (!guarded.ok) return guarded.response;
  const { body } = guarded;

  const idToken = stringField(body, "idToken") ?? "";
  if (idToken.length === 0 || idToken.length > 10_000) {
    return authErrorResponse(400, "INVALID_REQUEST", "The request isn’t valid.");
  }

  const session = await requireSession(request);
  if (!session.ok) {
    return authErrorResponse(session.status, session.code, session.message);
  }

  let adminAuth: ReturnType<typeof getFirebaseAdminAuth>;
  try {
    adminAuth = getFirebaseAdminAuth();
  } catch (error) {
    console.error("Firebase Admin resend-verification is not configured.", error);
    return authErrorResponse(503, "AUTH_NOT_CONFIGURED", "Account services aren’t configured for this deployment.");
  }

  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return authErrorResponse(401, "AUTH_INVALID", "Your sign-in has expired. Sign in again.");
  }
  if (uid !== session.uid) {
    return authErrorResponse(401, "SESSION_MISMATCH", "Your session doesn’t match this account. Sign in again.");
  }

  const rateLimit = await checkWindowLimit(
    `xyro:auth:resend-verification:user:${uid}`,
    60 * 1000,
    1,
  );
  if (rateLimit.state !== "allowed") {
    const limited = rateLimitedResponse(rateLimit);
    return authErrorResponse(
      limited.status,
      limited.code,
      "Please wait a minute before asking for another verification email.",
      {
        ...(limited.retryAfter
          ? { "Retry-After": String(limited.retryAfter) }
          : {}),
      },
    );
  }

  const result = await sendOobCodeServer({
    requestType: "VERIFY_EMAIL",
    idToken,
  });
  if (result.state === "misconfigured") {
    return authErrorResponse(503, "RESEND_NOT_CONFIGURED", "Verification email isn’t configured for this deployment.");
  }
  if (result.state === "unavailable") {
    return authErrorResponse(503, "RESEND_FAILED", "We couldn’t send the verification email right now. Please try again.");
  }

  return NextResponse.json(
    { success: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

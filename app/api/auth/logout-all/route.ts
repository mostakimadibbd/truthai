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
import {
  clearSession,
  requireSession,
  revokeAllSessionsForUser,
  revokeSession,
} from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 16_384;
const ABSOLUTE_SESSION_MS = 90 * 24 * 60 * 60 * 1000;

// "Sign out of all devices" (Phase 2). Requires BOTH the session
// cookie and a Firebase ID token whose uid matches it, then:
//  - sets validAfter:{uid} in Redis, so every session cookie issued
//    before now is rejected by requireSession on all devices,
//  - revokes the current sid explicitly as well,
//  - calls Firebase Admin revokeRefreshTokens(uid), so other devices
//    cannot mint fresh ID tokens either, and
//  - clears this browser's cookie.
// API access on other devices stops immediately (revocation is checked
// per request, cached at most 30 s). If Firebase Admin or Redis is not
// configured, the route fails cleanly with 503 and nothing is
// half-applied by this endpoint beyond the cookie clear on success
// paths only.
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
    console.error("Firebase Admin logout-all is not configured.", error);
    return authErrorResponse(
      503,
      "AUTH_NOT_CONFIGURED",
      "Sign out of all devices isn’t configured for this deployment.",
    );
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

  // Phase 4 audit addition: global revocation is destructive — cap
  // at 10 runs per user per hour (fail closed).
  const logoutAllLimit = await checkWindowLimit(
    `xyro:auth:logout-all:user:${uid}`,
    60 * 60 * 1000,
    10,
  );
  if (logoutAllLimit.state !== "allowed") {
    const limited = rateLimitedResponse(logoutAllLimit);
    return authErrorResponse(limited.status, limited.code, limited.message, {
      ...(limited.retryAfter
        ? { "Retry-After": String(limited.retryAfter) }
        : {}),
    });
  }

  try {
    await revokeAllSessionsForUser(uid);
    await revokeSession(
      session.sid,
      Math.max(0, session.absExp - Date.now()) || ABSOLUTE_SESSION_MS,
    );
  } catch (error) {
    // Redis revocation is best-effort in the same way as single
    // logout; refresh-token revocation below still applies.
    console.error("Redis session revocation failed during logout-all.", error);
  }

  try {
    await adminAuth.revokeRefreshTokens(uid);
  } catch (error) {
    console.error("Firebase refresh-token revocation failed during logout-all.", error);
    return authErrorResponse(
      503,
      "LOGOUT_ALL_FAILED",
      "We couldn’t sign out your other devices right now. Please try again.",
    );
  }

  const response = NextResponse.json(
    { success: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  clearSession(response);
  return response;
}

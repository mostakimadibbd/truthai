import type { NextRequest } from "next/server";
import { getFirebaseAdminAuth } from "@/lib/server/firebase-admin";
import { requireSession, type SessionResult } from "@/lib/server/session";

// Session + ID-token authentication for the Phase 3 APIs (settings,
// models, usage, export, account).
//
// Design decision (documented per the Phase 3 brief): every one of
// these APIs requires the Turnstile-gated session cookie AND a Firebase
// ID token whose uid matches the session. Email verification is NOT
// required here — settings, profile, usage and export are account
// management, and Phase 2 deliberately lets unverified users into the
// app (only sending chat messages is gated on verification, which
// authenticateVerifiedUser in request-auth.ts continues to enforce for
// /api/chat and uploads). Requiring verification for settings would lock
// unverified users out of the very resend-verification controls they
// need. Destructive account routes additionally re-authenticate with
// the account password server-side.

export type SessionUser =
  | {
      ok: true;
      uid: string;
      sid: string;
      email: string | null;
      emailVerified: boolean;
      providers: string[];
      session: Extract<SessionResult, { ok: true }>;
    }
  | {
      ok: false;
      status: 401 | 503;
      code: string;
      message: string;
    };

export async function authenticateSessionUser(
  request: NextRequest,
): Promise<SessionUser> {
  // Session first: it needs no Firebase Admin, so an unauthenticated
  // request is a clean 401 even on deployments where Admin is missing,
  // and a request WITH a session but no Admin is a clean 503.
  const session = await requireSession(request);
  if (!session.ok) {
    return {
      ok: false,
      status: session.status,
      code: session.code,
      message: session.message,
    };
  }

  const idToken = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/i)?.[1];
  if (!idToken || idToken.length > 10_000) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_REQUIRED",
      message: "Sign in to continue.",
    };
  }

  let auth: ReturnType<typeof getFirebaseAdminAuth>;
  try {
    auth = getFirebaseAdminAuth();
  } catch (error) {
    console.error("Firebase Admin is not configured.", error);
    return {
      ok: false,
      status: 503,
      code: "AUTH_NOT_CONFIGURED",
      message: "Account services aren’t configured for this deployment.",
    };
  }

  try {
    const decoded = await auth.verifyIdToken(idToken);
    if (decoded.uid !== session.uid) {
      return {
        ok: false,
        status: 401,
        code: "SESSION_MISMATCH",
        message: "Your session doesn’t match this account. Sign in again.",
      };
    }
    const identities = (
      decoded.firebase as
        | { identities?: Record<string, unknown> }
        | undefined
    )?.identities;
    const providers = identities ? Object.keys(identities) : [];
    return {
      ok: true,
      uid: decoded.uid,
      sid: session.sid,
      email: typeof decoded.email === "string" ? decoded.email : null,
      emailVerified: decoded.email_verified === true,
      providers:
        providers.length > 0
          ? providers
          : typeof decoded.firebase?.sign_in_provider === "string"
            ? [decoded.firebase.sign_in_provider]
            : [],
      session,
    };
  } catch {
    return {
      ok: false,
      status: 401,
      code: "AUTH_INVALID",
      message: "Your sign-in has expired. Sign in again.",
    };
  }
}

/** Session-only check (no Admin, no ID token) for routes that order
 * validation before Admin work, e.g. PATCH /api/settings. */
export async function requireSessionOnly(
  request: NextRequest,
): Promise<SessionResult> {
  return requireSession(request);
}

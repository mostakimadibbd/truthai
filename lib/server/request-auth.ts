import type { NextRequest } from "next/server";
import { getFirebaseAdminAuth } from "@/lib/server/firebase-admin";

export type AuthenticatedUser =
  | { ok: true; uid: string }
  | {
      ok: false;
      status: 401 | 403 | 503;
      code: string;
      message: string;
    };

export async function authenticateVerifiedUser(
  request: NextRequest,
): Promise<AuthenticatedUser> {
  const idToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!idToken || idToken.length > 10_000) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_REQUIRED",
      message: "Sign in to use chat.",
    };
  }

  let auth: ReturnType<typeof getFirebaseAdminAuth>;
  try {
    auth = getFirebaseAdminAuth();
  } catch (error) {
    console.error("Firebase Admin authentication is not configured.", error);
    return {
      ok: false,
      status: 503,
      code: "AUTH_NOT_CONFIGURED",
      message: "Account services aren’t configured for this deployment.",
    };
  }

  try {
    const decoded = await auth.verifyIdToken(idToken);
    if (decoded.email_verified !== true) {
      return {
        ok: false,
        status: 403,
        code: "EMAIL_NOT_VERIFIED",
        message: "Verify your email before using chat.",
      };
    }
    return { ok: true, uid: decoded.uid };
  } catch {
    return {
      ok: false,
      status: 401,
      code: "AUTH_INVALID",
      message: "Your session has expired. Sign in again.",
    };
  }
}

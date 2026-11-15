import { FieldValue } from "firebase-admin/firestore";
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
import {
  getFirebaseAdminAuth,
  getFirebaseAdminFirestore,
} from "@/lib/server/firebase-admin";
import { createSession, isSessionConfigured } from "@/lib/server/session";
import { recordSessionLogin } from "@/lib/server/session-record";
import { getRemoteIp, verifyTurnstile } from "@/lib/server/turnstile";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 16_384;
const SESSION_ACTIONS = ["sign_in", "create_account", "session_refresh"] as const;
type SessionAction = (typeof SESSION_ACTIONS)[number];

// Session issuance for Google sign-in and silent renewals. The client
// authenticates with Google through Firebase, then exchanges the fresh
// ID token here together with a Turnstile token. Only then does the
// server set the Turnstile-gated session cookie and upsert the profile.
export async function POST(request: NextRequest) {
  const guarded = await guardAuthPost(request, MAX_BODY_BYTES);
  if (!guarded.ok) return guarded.response;
  const { body } = guarded;

  const idToken = stringField(body, "idToken") ?? "";
  const turnstileToken = stringField(body, "turnstileToken") ?? "";
  const action = stringField(body, "action") ?? "";
  const deviceId = stringField(body, "deviceId") ?? undefined;
  const termsAccepted = body.termsAccepted;
  if (
    idToken.length === 0 ||
    idToken.length > 10_000 ||
    turnstileToken.length === 0 ||
    !SESSION_ACTIONS.includes(action as SessionAction)
  ) {
    return authErrorResponse(
      400,
      "INVALID_SESSION_REQUEST",
      "The session request isn’t valid. Complete the security check and try again.",
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
      key: `xyro:auth:session:ip:${hashRateLimitKeyPart(remoteIp ?? "unknown")}`,
      windowMs: 60 * 60 * 1000,
      max: 20,
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
    expectedAction: action as SessionAction,
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

  let adminAuth: ReturnType<typeof getFirebaseAdminAuth>;
  try {
    adminAuth = getFirebaseAdminAuth();
  } catch (error) {
    console.error("Firebase Admin session is not configured.", error);
    return authErrorResponse(503, "SESSION_NOT_CONFIGURED", "Account sessions aren’t configured for this deployment.");
  }

  let decoded: Awaited<ReturnType<typeof adminAuth.verifyIdToken>>;
  try {
    decoded = await adminAuth.verifyIdToken(idToken, true);
  } catch {
    return authErrorResponse(401, "AUTH_INVALID", "Your sign-in has expired. Sign in again.");
  }

  // For interactive sign-ins the token must be fresh: auth_time within
  // the last 5 minutes proves the user just authenticated with Google.
  // session_refresh is the exception — a refreshed ID token keeps the
  // original auth_time by design, so freshness there is proven by the
  // Turnstile session_refresh check plus the revoked-token check above.
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (action !== "session_refresh" && nowSeconds - decoded.auth_time > 300) {
    return authErrorResponse(401, "AUTH_STALE", "Your sign-in has expired. Sign in again.");
  }

  let user: Awaited<ReturnType<typeof adminAuth.getUser>>;
  try {
    user = await adminAuth.getUser(decoded.uid);
  } catch (error) {
    console.error("Firebase user lookup failed during session creation.", error);
    return authErrorResponse(503, "SESSION_FAILED", "We couldn’t start your session right now. Please try again.");
  }
  if (user.disabled) {
    return authErrorResponse(403, "ACCOUNT_DISABLED", "This account is disabled. Contact the site administrator for help.");
  }

  // A brand-new account (created within the last 10 minutes) must have
  // accepted the terms on the sign-up form before a session is issued.
  const creationTime = Date.parse(user.metadata.creationTime);
  const isNewAccount =
    Number.isFinite(creationTime) && Date.now() - creationTime < 10 * 60 * 1000;
  if (isNewAccount && action !== "session_refresh" && termsAccepted !== true) {
    return authErrorResponse(
      400,
      "TERMS_REQUIRED",
      "Accept the Terms and Conditions to create an account.",
    );
  }

  // Upsert the profile server-side (clients no longer need write access
  // for sign-in bookkeeping). lastSignInAt moves at most once per 24 h.
  try {
    const db = getFirebaseAdminFirestore();
    const profileRef = db.collection("users").doc(decoded.uid);
    const existing = await profileRef.get();
    const existingData = existing.data();
    const lastSignInAt =
      existingData?.lastSignInAt &&
      typeof existingData.lastSignInAt.toMillis === "function"
        ? existingData.lastSignInAt.toMillis()
        : 0;
    const profile: Record<string, unknown> = {
      uid: decoded.uid,
      email: user.email ?? decoded.email ?? "",
      displayName: user.displayName ?? "",
      photoURL: user.photoURL ?? "",
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!existing.exists) {
      profile.createdAt = FieldValue.serverTimestamp();
    }
    if (Date.now() - lastSignInAt > 24 * 60 * 60 * 1000) {
      profile.lastSignInAt = FieldValue.serverTimestamp();
    }
    await profileRef.set(profile, { merge: true });
  } catch (error) {
    console.error("Server profile upsert failed during session creation.", error);
    return authErrorResponse(503, "PROFILE_SAVE_FAILED", "We couldn’t save your profile right now. Please try again.");
  }

  const response = NextResponse.json(
    { success: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  const { sid } = await createSession(response, decoded.uid);
  // Record interactive logins in the Settings session list. Silent
  // session_refresh renewals are skipped: they would mint a fresh sid
  // each time and fill the list with duplicate devices.
  if (action !== "session_refresh") {
    await recordSessionLogin(decoded.uid, sid, request, {
      deviceId,
      eventType: "google_sign_in",
    });
  }
  return response;
}

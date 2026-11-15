import { FieldValue } from "firebase-admin/firestore";
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
import {
  getFirebaseAdminAuth,
  getFirebaseAdminFirestore,
} from "@/lib/server/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 4096;

// Display-name edit. The server updates Firebase Auth and the
// Firestore profile together (clients can no longer write the profile
// for bookkeeping — see Phase 1), keeping header, sidebar and settings
// consistent. Name is trimmed and capped at 100 characters, matching
// the Firestore profile rules.
export async function PATCH(request: NextRequest) {
  const guarded = await guardAuthPost(request, MAX_BODY_BYTES);
  if (!guarded.ok) return guarded.response;

  const displayName = stringField(guarded.body, "displayName");
  if (
    displayName === undefined ||
    displayName.trim().length === 0 ||
    displayName.trim().length > 100
  ) {
    return authErrorResponse(
      400,
      "INVALID_DISPLAY_NAME",
      "Enter a display name of up to 100 characters.",
    );
  }

  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }

  // Phase 4 audit addition: profile writes capped at 60 per user
  // per hour (fail closed), in line with the other settings writes.
  const profileLimit = await checkWindowLimit(
    `xyro:settings:profile:user:${auth.uid}`,
    60 * 60 * 1000,
    60,
  );
  if (profileLimit.state !== "allowed") {
    const limited = rateLimitedResponse(profileLimit);
    return authErrorResponse(limited.status, limited.code, limited.message, {
      ...(limited.retryAfter
        ? { "Retry-After": String(limited.retryAfter) }
        : {}),
    });
  }

  try {
    const name = displayName.trim();
    const adminAuth = getFirebaseAdminAuth();
    await adminAuth.updateUser(auth.uid, { displayName: name });
    await getFirebaseAdminFirestore()
      .collection("users")
      .doc(auth.uid)
      .set(
        { displayName: name, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    return NextResponse.json(
      { displayName: name },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Display name update failed.", error);
    return authErrorResponse(
      503,
      "PROFILE_UPDATE_FAILED",
      "Your name couldn’t be saved right now. Please try again.",
    );
  }
}

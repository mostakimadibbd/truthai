import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  guardAuthPost,
} from "@/lib/server/auth-guard";
import { authenticateSessionUser } from "@/lib/server/api-auth";
import {
  activateDeveloper,
  createApiKey,
  getDeveloperProfile,
  validateActivationInput,
} from "@/lib/server/developer";
import { getFirebaseAdminAuth } from "@/lib/server/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 8192;

// POST: activates developer access from the Settings popup answers
// and issues the first API key. The full key is returned exactly
// once, in this response; only its hash is stored. A verified email
// is required, matching the platform rule that unverified accounts
// cannot send messages.
export async function POST(request: NextRequest) {
  const guarded = await guardAuthPost(request, MAX_BODY_BYTES);
  if (!guarded.ok) return guarded.response;

  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }

  try {
    const user = await getFirebaseAdminAuth().getUser(auth.uid);
    if (user.disabled) {
      return authErrorResponse(403, "ACCOUNT_DISABLED", "This account is disabled.");
    }
    if (!user.emailVerified) {
      return authErrorResponse(
        403,
        "EMAIL_NOT_VERIFIED",
        "Verify your email address before activating developer access. Use the verification banner in your workspace, then try again.",
      );
    }

    const validation = validateActivationInput(guarded.body);
    if (!validation.ok) {
      return authErrorResponse(400, "INVALID_ACTIVATION", validation.message);
    }

    const existing = await getDeveloperProfile(auth.uid);
    if (existing) {
      return authErrorResponse(
        409,
        "ALREADY_ACTIVATED",
        "Developer access is already active on this account.",
      );
    }

    await activateDeveloper(auth.uid, validation.value);
    const { record, fullKey } = await createApiKey(auth.uid, "Default key");
    const profile = await getDeveloperProfile(auth.uid);
    return NextResponse.json(
      { profile, apiKey: fullKey, keyRecord: record },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Developer activation failed.", error);
    return authErrorResponse(
      503,
      "ACTIVATION_FAILED",
      "Developer access couldn’t be activated right now. Please try again.",
    );
  }
}

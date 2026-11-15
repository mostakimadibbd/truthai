import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  guardAuthPost,
} from "@/lib/server/auth-guard";
import { authenticateSessionUser } from "@/lib/server/api-auth";
import {
  checkWindowLimit,
  rateLimitedResponse,
} from "@/lib/server/auth-rate-limit";
import { requireSession } from "@/lib/server/session";
import {
  SETTINGS_SCHEMA_VERSION,
  invalidateInstructionsCache,
  preferencesRef,
  readPreferences,
  validatePreferencesPatch,
} from "@/lib/server/settings";
import { sanitizePreferences } from "@/lib/preferences";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 16_384;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// GET returns the full effective preferences (stored values merged over
// defaults). Auth: session cookie + ID token (uid match); verification
// is not required — see lib/server/api-auth.ts for the reasoning.
export async function GET(request: NextRequest) {
  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }
  try {
    const preferences = await readPreferences(auth.uid);
    return json({ preferences });
  } catch (error) {
    console.error("Couldn’t read settings.", error);
    return authErrorResponse(
      503,
      "SETTINGS_UNAVAILABLE",
      "Settings couldn’t be loaded right now. Please try again.",
    );
  }
}

// PATCH applies a strict allow-listed patch. Ordering is deliberate:
// guard (origin/headers) → session (401 without Admin) → validation
// (400) → rate limit → Admin/Firestore write (503 when Admin is not
// configured), so unauthenticated and malformed requests are answered
// without touching Firebase at all.
export async function PATCH(request: NextRequest) {
  const guarded = await guardAuthPost(request, MAX_BODY_BYTES);
  if (!guarded.ok) return guarded.response;

  const session = await requireSession(request);
  if (!session.ok) {
    return authErrorResponse(session.status, session.code, session.message);
  }

  const validation = validatePreferencesPatch(guarded.body);
  if (!validation.ok) {
    return authErrorResponse(400, "INVALID_SETTINGS", validation.message);
  }

  const rateLimit = await checkWindowLimit(
    `xyro:settings:patch:user:${session.uid}`,
    60 * 60 * 1000,
    120,
  );
  if (rateLimit.state !== "allowed") {
    const limited = rateLimitedResponse(rateLimit);
    return authErrorResponse(limited.status, limited.code, limited.message, {
      ...(limited.retryAfter
        ? { "Retry-After": String(limited.retryAfter) }
        : {}),
    });
  }

  // The ID token must belong to the session's user. This needs Admin,
  // so it runs after validation; a missing Admin config is a clean 503.
  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }

  try {
    await preferencesRef(auth.uid).set(
      {
        ...validation.patch,
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    invalidateInstructionsCache(auth.uid);
    const preferences = await readPreferences(auth.uid);
    return json({ preferences: sanitizePreferences(preferences) });
  } catch (error) {
    console.error("Couldn’t save settings.", error);
    return authErrorResponse(
      503,
      "SETTINGS_SAVE_FAILED",
      "Your change couldn’t be saved. Please try again.",
    );
  }
}

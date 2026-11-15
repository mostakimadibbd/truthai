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
import { revokeSession } from "@/lib/server/session";
import {
  deleteSessionRecord,
  listSessionRecords,
} from "@/lib/server/session-record";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 4096;
const SESSION_ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000;

function json(data: unknown) {
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}

// GET: the session list for Settings → Security, plus the account's
// sign-in methods (from the Admin user record's providerData — the
// reliable source; ID-token identity claims only cover the provider
// used for the current sign-in).
export async function GET(request: NextRequest) {
  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }
  try {
    const adminAuth = getFirebaseAdminAuth();
    const user = await adminAuth.getUser(auth.uid);
    const sessions = await listSessionRecords(auth.uid, auth.sid);
    return json({
      sessions,
      currentSid: auth.sid,
      methods: user.providerData.map((provider) => ({
        id: provider.providerId,
        email: provider.email ?? null,
      })),
      email: user.email ?? auth.email,
      emailVerified: user.emailVerified,
    });
  } catch (error) {
    console.error("Couldn’t load sessions.", error);
    return authErrorResponse(
      503,
      "SESSIONS_UNAVAILABLE",
      "Your sessions couldn’t be loaded right now. Please try again.",
    );
  }
}

// POST {action: "revoke", sid} — sign out one other device.
// POST {action: "revokeOthers"} — sign out every other device.
//
// Revocation is per-sid: a Redis revoked:{sid} flag (checked by
// requireSession on every API call, so the other device loses API
// access immediately) plus deletion of its Settings record. The
// current session is never touched by these actions. validAfter:{uid}
// is deliberately not used here — it would invalidate the current
// session too (see the password-change route for the same reasoning);
// validAfter + revokeRefreshTokens remain the tools of the Phase 2
// "sign out of all devices" flow, where this device signs out as well.
export async function POST(request: NextRequest) {
  const guarded = await guardAuthPost(request, MAX_BODY_BYTES);
  if (!guarded.ok) return guarded.response;

  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }

  const action = stringField(guarded.body, "action") ?? "";

  // Phase 4 audit addition: session revocation is destructive —
  // cap at 30 runs per user per hour (fail closed).
  const revokeLimit = await checkWindowLimit(
    `xyro:account:sessions-revoke:user:${auth.uid}`,
    60 * 60 * 1000,
    30,
  );
  if (revokeLimit.state !== "allowed") {
    const limited = rateLimitedResponse(revokeLimit);
    return authErrorResponse(limited.status, limited.code, limited.message, {
      ...(limited.retryAfter
        ? { "Retry-After": String(limited.retryAfter) }
        : {}),
    });
  }

  try {
    if (action === "revoke") {
      const sid = stringField(guarded.body, "sid") ?? "";
      if (!sid || sid === auth.sid) {
        return authErrorResponse(
          400,
          "INVALID_SESSION",
          "Choose another device to sign out. To sign out this device, use Sign out.",
        );
      }
      await revokeSession(sid, SESSION_ABSOLUTE_MS);
      await deleteSessionRecord(auth.uid, sid);
      return json({ success: true });
    }

    if (action === "revokeOthers") {
      const records = await listSessionRecords(auth.uid, auth.sid);
      let revoked = 0;
      for (const record of records) {
        if (record.sid === auth.sid) continue;
        await revokeSession(record.sid, SESSION_ABSOLUTE_MS);
        await deleteSessionRecord(auth.uid, record.sid);
        revoked += 1;
      }
      return json({ success: true, revoked });
    }

    return authErrorResponse(400, "INVALID_ACTION", "That action isn’t recognised.");
  } catch (error) {
    console.error("Session revocation failed.", error);
    return authErrorResponse(
      503,
      "REVOKE_FAILED",
      "That device couldn’t be signed out. Please try again.",
    );
  }
}

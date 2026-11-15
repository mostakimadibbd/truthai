import { NextRequest, NextResponse } from "next/server";
import {
  refreshSessionIfNeeded,
  requireSession,
} from "@/lib/server/session";
import { touchSessionRecord } from "@/lib/server/session-record";

export const runtime = "nodejs";

// Lightweight session probe for the client-side AuthSync component.
// The session cookie is HttpOnly, so the browser cannot read it
// directly; this route is how the client learns whether a valid
// server session exists (and for which uid) without exposing the
// cookie. It runs the full requireSession check (signature, expiry,
// Redis revocation), and it is also where the sliding re-issue
// happens for page loads: when requireSession flags the cookie as
// close to expiry, refreshSessionIfNeeded sets a fresh cookie on this
// response (same sid, same absolute expiry).
//
// Always 200 with a JSON body and Cache-Control: no-store — callers
// distinguish "signed out" from "revoked" via the flags, and any
// non-200 (network, deployment) must be treated by the client as
// "unknown", never as a reason to sign anyone out.
//
// Phase 4 audit: deliberately NO rate limit here. This is a cheap
// GET probe the client runs on page loads and focus changes; it
// performs no writes of its own (the lastActive touch is throttled
// to one Firestore write per 6 hours inside touchSessionRecord) and
// its cost is already bounded by requireSession's 30-second
// in-memory revocation cache. Limiting it could break the probe
// contract above (a 429 would still be "unknown" to the client, but
// would suppress the sliding session re-issue).
export async function GET(request: NextRequest) {
  const session = await requireSession(request);

  if (!session.ok) {
    return NextResponse.json(
      {
        authenticated: false,
        revoked: session.code === "SESSION_REVOKED",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const response = NextResponse.json(
    { authenticated: true, uid: session.uid },
    { headers: { "Cache-Control": "no-store" } },
  );
  await refreshSessionIfNeeded(response, session);
  // Keep the Settings session list's lastActiveAt fresh, throttled
  // inside touchSessionRecord to one write per 6 hours per session.
  await touchSessionRecord(session.uid, session.sid, request);
  return response;
}

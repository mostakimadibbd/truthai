import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, guardAuthPost } from "@/lib/server/auth-guard";
import {
  checkWindowLimit,
  hashRateLimitKeyPart,
  rateLimitedResponse,
} from "@/lib/server/auth-rate-limit";
import {
  clearSession,
  requireSession,
  revokeSession,
} from "@/lib/server/session";
import { getRemoteIp } from "@/lib/server/turnstile";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 1024;
const ABSOLUTE_SESSION_MS = 90 * 24 * 60 * 60 * 1000;

// Signs the current session out: the sid is revoked in Redis (when
// configured) so the cookie stops working immediately, and the cookie
// is cleared. The Phase 2 sign-out UI builds its confirmation flow on
// top of this endpoint.
export async function POST(request: NextRequest) {
  const guarded = await guardAuthPost(request, MAX_BODY_BYTES);
  if (!guarded.ok) return guarded.response;

  // Phase 4 audit addition: generous IP cap (60/hour) so the
  // revocation endpoint can't be hammered, without ever realistically
  // blocking a genuine sign-out.
  const logoutLimit = await checkWindowLimit(
    `xyro:auth:logout:ip:${hashRateLimitKeyPart(getRemoteIp(request) ?? "unknown")}`,
    60 * 60 * 1000,
    60,
  );
  if (logoutLimit.state !== "allowed") {
    const limited = rateLimitedResponse(logoutLimit);
    return authErrorResponse(limited.status, limited.code, limited.message, {
      ...(limited.retryAfter
        ? { "Retry-After": String(limited.retryAfter) }
        : {}),
    });
  }

  const session = await requireSession(request);
  const response = NextResponse.json(
    { success: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  if (session.ok) {
    try {
      await revokeSession(
        session.sid,
        Math.max(0, session.absExp - Date.now()) || ABSOLUTE_SESSION_MS,
      );
    } catch (error) {
      // Revocation is best-effort; clearing the cookie still signs this
      // browser out.
      console.error("Session revocation failed during logout.", error);
    }
  }
  clearSession(response);
  return response;
}

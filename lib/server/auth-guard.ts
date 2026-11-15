import { NextRequest, NextResponse } from "next/server";
import { siteUrl } from "@/lib/site";

// Shared guard for the /api/auth/* POST routes. Every one of them must
// be a same-origin JSON POST that carries the X-Requested-With: xyro
// header (a simple CSRF / drive-by-form defence: cross-origin forms
// cannot set custom headers without a CORS preflight, which we never
// grant). All responses are Cache-Control: no-store.

export function authErrorResponse(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false; // Missing Origin is rejected.
  // The site origin is canonical; the request's own origin is also
  // accepted so Vercel preview deployments (per-deployment URLs) work.
  return origin === siteUrl || origin === request.nextUrl.origin;
}

/**
 * Header-only mutation guard (Phase 4) for routes that parse their
 * own bodies — the session+token APIs under /api/chat, /api/chats*
 * and /api/uploads/*. Every POST/PATCH/DELETE in the app must pass
 * this (or guardAuthPost, which applies the same checks): a matching
 * Origin is REQUIRED (a missing Origin is rejected, not tolerated)
 * and the X-Requested-With: xyro header must be present. Returns the
 * error response to send, or null when the request may proceed.
 */
export function guardMutationHeaders(request: NextRequest): NextResponse | null {
  if (!isAllowedOrigin(request)) {
    return authErrorResponse(
      403,
      "ORIGIN_NOT_ALLOWED",
      "This request origin isn’t allowed.",
    );
  }
  if (request.headers.get("x-requested-with") !== "xyro") {
    return authErrorResponse(
      400,
      "INVALID_REQUEST",
      "The request isn’t valid.",
    );
  }
  return null;
}

export type GuardedJsonBody =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse };

export async function guardAuthPost(
  request: NextRequest,
  maxBodyBytes: number,
): Promise<GuardedJsonBody> {
  if (!isAllowedOrigin(request)) {
    return {
      ok: false,
      response: authErrorResponse(
        403,
        "ORIGIN_NOT_ALLOWED",
        "This request origin isn’t allowed.",
      ),
    };
  }

  if (request.headers.get("x-requested-with") !== "xyro") {
    return {
      ok: false,
      response: authErrorResponse(
        400,
        "INVALID_REQUEST",
        "The request isn’t valid.",
      ),
    };
  }

  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  const contentLength = Number(request.headers.get("content-length"));
  if (
    contentType !== "application/json" ||
    (Number.isFinite(contentLength) && contentLength > maxBodyBytes)
  ) {
    return {
      ok: false,
      response: authErrorResponse(
        400,
        "INVALID_REQUEST",
        "The request isn’t valid.",
      ),
    };
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return {
      ok: false,
      response: authErrorResponse(
        400,
        "INVALID_REQUEST",
        "The request isn’t valid.",
      ),
    };
  }
  if (new TextEncoder().encode(rawBody).byteLength > maxBodyBytes) {
    return {
      ok: false,
      response: authErrorResponse(
        400,
        "INVALID_REQUEST",
        "The request is too large.",
      ),
    };
  }

  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Body must be a JSON object.");
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: authErrorResponse(
        400,
        "INVALID_REQUEST",
        "The request isn’t valid JSON.",
      ),
    };
  }
}

export function stringField(
  body: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = body[name];
  return typeof value === "string" ? value : undefined;
}

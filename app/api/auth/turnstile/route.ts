import { NextRequest, NextResponse } from "next/server";
import { verifyTurnstileToken } from "@/lib/server/turnstile";

export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "This request origin isn’t allowed.");
  }

  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  const contentLength = Number(request.headers.get("content-length"));
  if (
    contentType !== "application/json" ||
    (Number.isFinite(contentLength) && contentLength > 4096)
  ) {
    return errorResponse(400, "INVALID_REQUEST", "The verification request isn’t valid.");
  }

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 4096) {
      return errorResponse(400, "INVALID_REQUEST", "The verification request is too large.");
    }
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "The verification request isn’t valid JSON.");
  }

  const token =
    typeof body === "object" && body !== null && "token" in body
      ? body.token
      : undefined;
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    return errorResponse(400, "TURNSTILE_REQUIRED", "Complete the security check and try again.");
  }

  const verification = await verifyTurnstileToken(token, request.nextUrl.hostname);
  if (verification.state === "misconfigured") {
    return errorResponse(503, "TURNSTILE_NOT_CONFIGURED", "Account security verification isn’t configured.");
  }
  if (verification.state === "unavailable") {
    return errorResponse(503, "TURNSTILE_UNAVAILABLE", "Security verification is temporarily unavailable.");
  }
  if (verification.state === "invalid") {
    return errorResponse(403, "TURNSTILE_INVALID", "The security check expired or was invalid. Please try again.");
  }

  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}

import { NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/server/env";

export const runtime = "nodejs";
export const maxDuration = 30;

// Completes a human verification for the backend's bot
// protection: the /bot-check page collects a Turnstile token,
// and this route forwards it — with the visitor's IP and user
// agent as seen here — to the backend's service-token-gated
// verify endpoint. On success the backend clears the IP's
// flags and mints a signed human pass, kept here in an
// httpOnly cookie. The backend address and service token
// never reach the browser.
export async function POST(request: NextRequest) {
  const backendUrl = serverEnv.backendUrl;
  const serviceToken = serverEnv.backendServiceToken;
  if (!backendUrl || !serviceToken) {
    return NextResponse.json(
      { ok: false, error: "Verification is not available right now." },
      { status: 503 },
    );
  }
  let token = "";
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body?.token === "string" ? body.token : "";
  } catch {
    token = "";
  }
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Complete the verification first." },
      { status: 400 },
    );
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const userAgent = request.headers.get("user-agent") ?? "";
  let pass = "";
  try {
    const response = await fetch(`${backendUrl}/v1/bot/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Token": serviceToken,
      },
      body: JSON.stringify({ token, ip, userAgent }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return NextResponse.json(
        { ok: false, error: "Verification didn’t pass. Please try again." },
        { status: 403 },
      );
    }
    const payload = (await response.json()) as { pass?: unknown };
    pass = typeof payload?.pass === "string" ? payload.pass : "";
  } catch {
    return NextResponse.json(
      { ok: false, error: "Verification service is unreachable. Please try again." },
      { status: 503 },
    );
  }
  const result = NextResponse.json({ ok: true });
  if (pass) {
    result.cookies.set("xyro_human_pass", pass, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 1800,
    });
  }
  return result;
}

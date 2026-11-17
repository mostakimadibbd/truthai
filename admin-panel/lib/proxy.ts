import { NextRequest, NextResponse } from "next/server";
import { serverEnv } from "./server-env";

/**
 * Server-side proxy to the backend service's admin API.
 *
 * The backend's address and both secrets live ONLY in this
 * app's server environment — they are never sent to the
 * browser. Every call carries the service token, the dedicated
 * admin secret, and the signed-in administrator's own Firebase
 * ID token, which the backend verifies together with the
 * account's database admin flag.
 */
export async function proxyAdmin(
  request: NextRequest,
  path: string,
  init: { method: string; body?: unknown },
): Promise<NextResponse> {
  const base = serverEnv.backendUrl;
  const serviceToken = serverEnv.backendServiceToken;
  const adminSecret = serverEnv.adminApiSecret;
  if (!base || !serviceToken || !adminSecret) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "PANEL_NOT_CONFIGURED",
          message: "This panel is not connected to the backend yet.",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const authorization = request.headers.get("authorization") ?? "";
  try {
    const response = await fetch(`${base}${path}`, {
      method: init.method,
      headers: {
        "X-Service-Token": serviceToken,
        "X-Admin-Secret": adminSecret,
        Authorization: authorization,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    const payload = await response.json().catch(() => ({
      success: false,
      error: { code: "BACKEND_ERROR", message: "The backend returned an unreadable response." },
    }));
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "BACKEND_UNREACHABLE",
          message: "The backend service could not be reached.",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

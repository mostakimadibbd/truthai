import { NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/server-env";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Multipart passthrough for admin media uploads. proxyAdmin is
 * JSON-only, so this route forwards the form data with the same
 * server-side credentials (backend URL + service token + admin
 * secret stay server-side; the admin's ID token rides along).
 */
export async function POST(request: NextRequest) {
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
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: { code: "INVALID_BODY", message: "Attach a file to upload." },
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "INVALID_BODY", message: "Attach a file to upload." },
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const outgoing = new FormData();
  outgoing.append("file", file, file.name);
  outgoing.append(
    "resourceType",
    typeof form.get("resourceType") === "string"
      ? (form.get("resourceType") as string)
      : "",
  );
  try {
    const response = await fetch(`${base}/v1/admin/media/upload`, {
      method: "POST",
      headers: {
        "X-Service-Token": serviceToken,
        "X-Admin-Secret": adminSecret,
        Authorization: request.headers.get("authorization") ?? "",
      },
      body: outgoing,
      cache: "no-store",
      signal: AbortSignal.timeout(55_000),
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
        error: { code: "BACKEND_UNREACHABLE", message: "The backend service could not be reached." },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

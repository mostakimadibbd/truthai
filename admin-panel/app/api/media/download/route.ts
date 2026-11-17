import { NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/server-env";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Binary passthrough for downloading one Cloudinary asset
 * (including private/authenticated ones) through the backend's
 * signed download. Same server-side credential handling as the
 * upload proxy; the file bytes stream straight back.
 */
export async function GET(request: NextRequest) {
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
  const params = new URLSearchParams();
  for (const key of ["publicId", "resourceType", "format", "type"]) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) params.set(key, value);
  }
  try {
    const response = await fetch(
      `${base}/v1/admin/media/download?${params.toString()}`,
      {
        method: "GET",
        headers: {
          "X-Service-Token": serviceToken,
          "X-Admin-Secret": adminSecret,
          Authorization: request.headers.get("authorization") ?? "",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(55_000),
      },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => ({
        success: false,
        error: { code: "BACKEND_ERROR", message: "The download failed." },
      }));
      return NextResponse.json(payload, {
        status: response.status,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return new NextResponse(response.body, {
      status: 200,
      headers: {
        "Content-Type":
          response.headers.get("content-type") ?? "application/octet-stream",
        "Content-Disposition":
          response.headers.get("content-disposition") ?? "attachment",
        "Cache-Control": "no-store",
      },
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

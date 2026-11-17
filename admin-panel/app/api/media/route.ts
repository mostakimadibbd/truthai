import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Cloudinary asset inventory for the Media tab. */
export async function GET(request: NextRequest) {
  const prefix = request.nextUrl.searchParams.get("prefix") ?? "";
  const suffix = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
  return proxyAdmin(request, `/v1/admin/media${suffix}`, { method: "GET" });
}

/** Delete one asset: body {publicId, resourceType, deliveryType}. */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  return proxyAdmin(request, "/v1/admin/media/delete", {
    method: "POST",
    body: {
      publicId: typeof record.publicId === "string" ? record.publicId : "",
      resourceType:
        typeof record.resourceType === "string" ? record.resourceType : "",
      deliveryType:
        typeof record.deliveryType === "string" ? record.deliveryType : "",
    },
  });
}

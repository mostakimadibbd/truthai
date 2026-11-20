import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Detect the hidden watermark credentials in an uploaded image: body {imageBase64}. */
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
  return proxyAdmin(request, "/v1/admin/images/verify", {
    method: "POST",
    body: {
      imageBase64:
        typeof record.imageBase64 === "string" ? record.imageBase64 : "",
    },
  });
}

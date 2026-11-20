import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Move/rename one Cloudinary asset (admin only, audited by the backend). */
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
  const pick = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : "";
  return proxyAdmin(request, "/v1/admin/media/move", {
    method: "POST",
    body: {
      publicId: pick("publicId"),
      resourceType: pick("resourceType"),
      deliveryType: pick("deliveryType"),
      destination: pick("destination"),
    },
  });
}

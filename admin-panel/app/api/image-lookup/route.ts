import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Trace generated images by generation ID, creator fingerprint or creator uid. */
export async function GET(request: NextRequest) {
  const params = new URLSearchParams();
  for (const key of ["generationId", "fingerprint", "uid"]) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) params.set(key, value);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return proxyAdmin(request, `/v1/admin/images/lookup${suffix}`, { method: "GET" });
}

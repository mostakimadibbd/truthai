import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 30;

// Owner-secret test: forwards the attempt to the backend's
// no-op verification endpoint so the Owner tab can tell the
// owner exactly whether the secret is unset or incorrect.
export async function POST(request: NextRequest) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  return proxyAdmin(request, "/v1/admin/verify-owner-secret", {
    method: "POST",
    body,
  });
}

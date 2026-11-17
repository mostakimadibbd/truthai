import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  // Forward the directory-wide search query when present.
  const q = request.nextUrl.searchParams.get("q");
  const path = q ? `/v1/admin/users?q=${encodeURIComponent(q)}` : "/v1/admin/users";
  return proxyAdmin(request, path, { method: "GET" });
}

export async function PATCH(request: NextRequest) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  return proxyAdmin(request, "/v1/admin/users", { method: "PATCH", body });
}

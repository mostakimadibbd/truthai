import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  return proxyAdmin(request, "/v1/admin/users", { method: "GET" });
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

import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const uid = request.nextUrl.searchParams.get("uid") ?? "";
  return proxyAdmin(request, `/v1/admin/users/${encodeURIComponent(uid)}`, { method: "GET" });
}

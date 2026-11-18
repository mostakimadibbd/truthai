import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 30;

// Database explorer proxy (owner-only on the backend; the role
// is enforced there — this route only forwards). One route,
// three kinds: collections | docs | doc.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const kind = params.get("kind") ?? "collections";
  if (kind === "docs") {
    const path = params.get("path") ?? "";
    const limit = params.get("limit") ?? "25";
    const startAfter = params.get("startAfter") ?? "";
    return proxyAdmin(
      request,
      `/v1/admin/database/docs?path=${encodeURIComponent(path)}&limit=${encodeURIComponent(limit)}&startAfter=${encodeURIComponent(startAfter)}`,
      { method: "GET" },
    );
  }
  if (kind === "doc") {
    const path = params.get("path") ?? "";
    return proxyAdmin(
      request,
      `/v1/admin/database/doc?path=${encodeURIComponent(path)}`,
      { method: "GET" },
    );
  }
  return proxyAdmin(request, "/v1/admin/database/collections", { method: "GET" });
}

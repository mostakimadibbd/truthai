import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 30;

// Realtime log stream proxy. The backend reads Redis only —
// this feed costs zero Firestore reads, so the panel can poll
// it every few seconds safely on the free plan.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limit = params.get("limit") ?? "100";
  const service = params.get("service") ?? "";
  const level = params.get("level") ?? "";
  const query =
    `limit=${encodeURIComponent(limit)}` +
    (service ? `&service=${encodeURIComponent(service)}` : "") +
    (level ? `&level=${encodeURIComponent(level)}` : "");
  return proxyAdmin(request, `/v1/admin/live-logs?${query}`, { method: "GET" });
}

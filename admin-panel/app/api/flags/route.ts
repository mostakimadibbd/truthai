import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") ?? "";
  const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
  return proxyAdmin(request, `/v1/admin/flags${suffix}`, { method: "GET" });
}

/** Record a review decision: body {flagId, status}. */
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
  const flagId = typeof record.flagId === "string" ? record.flagId : "";
  const status = typeof record.status === "string" ? record.status : "";
  return proxyAdmin(
    request,
    `/v1/admin/flags/${encodeURIComponent(flagId)}/review`,
    { method: "POST", body: { status } },
  );
}

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4096;
const MAX_MESSAGE_LENGTH = 500;
const MAX_FIELD_LENGTH = 200;

// Simple in-memory rate limit (per instance), following the spirit of the
// existing routes: this endpoint only console.error's, so a lost counter on
// restart is acceptable and no Redis command budget is spent on it.
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60_000;
const hitsByIp = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hitsByIp.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    hitsByIp.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

function truncate(value: unknown, max: number): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

function noStore(status: number) {
  return new NextResponse(null, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  // Aligned with the shared mutation guard (Phase 4, tightened in
  // the Phase 9 audit): a matching Origin is REQUIRED — a missing
  // Origin is rejected, exactly like guardMutationHeaders — and the
  // X-Requested-With: xyro header is required as well.
  // lib/client-error.ts (the only caller, bundled with the app)
  // sends both; browser POSTs always carry an Origin. Reports are
  // best-effort by design, so a stale pre-Phase-4 bundle silently
  // losing error reports is an acceptable trade for closing this
  // unauthenticated endpoint to drive-by posts. The in-memory rate
  // limit below is kept: this route spends no Redis budget.
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) return noStore(403);
  if (request.headers.get("x-requested-with") !== "xyro") return noStore(400);

  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  if (contentType !== "application/json") return noStore(400);

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (isRateLimited(ip)) return noStore(429);

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return noStore(400);
    }
    body = JSON.parse(rawBody);
  } catch {
    return noStore(400);
  }
  if (typeof body !== "object" || body === null) return noStore(400);

  const record = body as Record<string, unknown>;
  // Only truncated, non-personal fields are kept: an error message, its
  // digest/name, and the pathname (query string is never accepted).
  const message = truncate(record.message, MAX_MESSAGE_LENGTH);
  if (!message) return noStore(400);

  console.error("[client-error]", {
    message,
    digest: truncate(record.digest, MAX_FIELD_LENGTH),
    name: truncate(record.name, MAX_FIELD_LENGTH),
    path: truncate(record.path, MAX_FIELD_LENGTH)?.split("?")[0],
  });

  return noStore(204);
}

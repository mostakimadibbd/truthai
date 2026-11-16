import { NextResponse } from "next/server";

// Removed: admin data is served only by the backend service's
// admin API to the separate admin panel. This route is a plain
// 404 so nothing in this app exposes admin data.
export async function GET() {
  return NextResponse.json(
    { success: false, error: { code: "NOT_FOUND", message: "Not found." } },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

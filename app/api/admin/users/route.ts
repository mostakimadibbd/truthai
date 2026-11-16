import { NextResponse } from "next/server";

// Removed: admin user controls live only in the backend
// service's admin API, reachable solely by the separate admin
// panel. These handlers are a plain 404.
function notFound() {
  return NextResponse.json(
    { success: false, error: { code: "NOT_FOUND", message: "Not found." } },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET() {
  return notFound();
}

export async function PATCH() {
  return notFound();
}

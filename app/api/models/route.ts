import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-guard";
import { authenticateSessionUser } from "@/lib/server/api-auth";
import { MODEL_MODES } from "@/lib/model-modes";

export const runtime = "nodejs";
export const maxDuration = 30;

// The model picker catalogue: three user-facing MODES (Fast /
// Thinking / Lightweight), never provider names. The server maps
// each mode to a preferred provider inside the fallback chain (see
// lib/model-modes.ts); every mode is free. Session + ID token
// required; the response is no-store because it is per-account API
// surface, even though the payload is not sensitive.
export async function GET(request: NextRequest) {
  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }
  return NextResponse.json(
    {
      models: MODEL_MODES.map((mode) => ({
        id: mode.id,
        name: mode.name,
        description: mode.description,
        contextLength: null,
        capabilities: ["text"],
      })),
      source: "modes",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

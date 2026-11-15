import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-guard";
import { authenticateSessionUser } from "@/lib/server/api-auth";
import { AUTO_MODEL_ID, getFreeModels } from "@/lib/server/models";

export const runtime = "nodejs";
export const maxDuration = 30;

// The free-model catalogue for the settings default-model control (and
// the next phase's chat model picker). Session + ID token required.
// The list itself is cached server-side for 10 minutes (see
// lib/server/models.ts); the response is marked no-store because it is
// per-account API surface, even though the payload is not sensitive.
export async function GET(request: NextRequest) {
  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }
  const { models, source } = await getFreeModels();
  return NextResponse.json(
    {
      models: [
        {
          id: AUTO_MODEL_ID,
          name: "Auto (Free)",
          contextLength: null,
          capabilities: ["text"],
        },
        ...models,
      ],
      source,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

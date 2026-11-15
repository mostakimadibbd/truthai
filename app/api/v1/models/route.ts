import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/server/developer";
import { getFreeModels } from "@/lib/server/models";

export const runtime = "nodejs";
export const maxDuration = 30;

// Public developer API — the free models currently available to API
// keys, in the OpenAI list shape. Authenticated like every /api/v1
// route.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
} as const;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const identity = await authenticateApiKey(
    request.headers.get("authorization"),
  ).catch(() => null);
  if (!identity) {
    return NextResponse.json(
      {
        error: {
          message:
            "Invalid or missing API key. Send your key as 'Authorization: Bearer xyro_sk_live_…'.",
          type: "authentication_error",
          code: "invalid_api_key",
        },
      },
      { status: 401, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } },
    );
  }
  const { models } = await getFreeModels();
  return NextResponse.json(
    {
      object: "list",
      data: models.map((model) => ({
        id: model.id,
        object: "model",
        name: model.name,
        context_length: model.contextLength,
        capabilities: model.capabilities,
      })),
    },
    { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } },
  );
}

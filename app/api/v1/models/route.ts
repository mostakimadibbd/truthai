import { NextRequest, NextResponse } from "next/server";
import {
  checkWindowLimit,
  hashRateLimitKeyPart,
} from "@/lib/server/auth-rate-limit";
import { authenticateApiKey } from "@/lib/server/developer";
import { getFreeModels } from "@/lib/server/models";
import { getRemoteIp } from "@/lib/server/turnstile";

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
    // Same failed-key throttling as chat completions.
    try {
      const failures = await checkWindowLimit(
        `xyro:api:authfail:ip:${hashRateLimitKeyPart(getRemoteIp(request) ?? "unknown")}`,
        60 * 1000,
        30,
      );
      if (failures.state === "limited") {
        return NextResponse.json(
          {
            error: {
              message:
                "Too many failed API key attempts from this network. Wait a minute and try again.",
              type: "rate_limit_error",
              code: "rate_limit_exceeded",
            },
          },
          {
            status: 429,
            headers: {
              ...CORS_HEADERS,
              "Cache-Control": "no-store",
              "Retry-After": String(failures.retryAfter),
            },
          },
        );
      }
    } catch {
      // Limiter trouble never changes the 401 below.
    }
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
        pricing: {
          prompt_per_million_usd: model.pricing.promptPerMillion,
          completion_per_million_usd: model.pricing.completionPerMillion,
        },
      })),
    },
    { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } },
  );
}

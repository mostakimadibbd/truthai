import { NextRequest, NextResponse } from "next/server";
import {
  checkWindowLimit,
  hashRateLimitKeyPart,
} from "@/lib/server/auth-rate-limit";
import {
  apiKeyAuthError,
  authenticateApiKey,
  type ApiKeyAuthResult,
} from "@/lib/server/developer";
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
  // The SAME strict gate as chat completions (see
  // authenticateApiKey): a revoked key, removed developer
  // access, or a disabled/unverified/deleted account gets
  // nothing here either — this route previously checked the
  // key alone and let those accounts through.
  const authResult = await authenticateApiKey(
    request.headers.get("authorization"),
  ).catch(
    (): ApiKeyAuthResult => ({ ok: false, reason: "account_unavailable" }),
  );
  if (!authResult.ok) {
    const failure = apiKeyAuthError(authResult.reason);
    // Same failed-key throttling as chat completions.
    if (
      authResult.reason === "invalid_key" ||
      authResult.reason === "developer_access_revoked"
    ) {
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
        // Limiter trouble never changes the refusal below.
      }
    }
    return NextResponse.json(
      {
        error: {
          message: failure.message,
          type: failure.status >= 500 ? "api_error" : "authentication_error",
          code: failure.code,
        },
      },
      {
        status: failure.status,
        headers: { ...CORS_HEADERS, "Cache-Control": "no-store" },
      },
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

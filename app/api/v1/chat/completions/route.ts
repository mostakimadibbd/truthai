import { serverEnv } from "@/lib/server/env";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  checkWindowLimit,
  hashRateLimitKeyPart,
} from "@/lib/server/auth-rate-limit";
import { recordBudget } from "@/lib/server/budget";
import { getDeviceContext } from "@/lib/server/device";
import {
  FREE_PLAN_DAILY_TOKEN_LIMIT,
  apiDateKey,
  authenticateApiKey,
  getDailyUsage,
  getDeveloperProfile,
  recordApiCall,
} from "@/lib/server/developer";
import {
  OpenRouterAttemptsExhausted,
  fetchChatCompletionWithFallback,
} from "@/lib/server/openrouter";
import { logEvent } from "@/lib/server/logstream";
import { readPreferences } from "@/lib/server/settings";
import { getRemoteIp } from "@/lib/server/turnstile";
import { getFirebaseAdminAuth } from "@/lib/server/firebase-admin";
import {
  AUTO_MODEL_ID,
  isAllowedFreeModel,
  modelAttemptOrder,
} from "@/lib/server/models";

export const runtime = "nodejs";
export const maxDuration = 300;

// Public developer API — OpenAI-compatible chat completions backed
// by the same free OpenRouter models as the app. Authenticated with
// a Xyro API key (Authorization: Bearer xyro_sk_live_…), metered
// against the free plan's daily token limit, and every call is
// recorded with its request fingerprint (device label, parsed user
// agent, IP hash, coarse geo) in the owner's apiEvents collection.

const MAX_BODY_BYTES = 256 * 1024;
const MAX_MESSAGES = 50;
const MAX_CONTENT_CHARS = 32_000;
const REQUESTS_PER_MINUTE_PER_KEY = 20;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
} as const;

function apiError(
  status: number,
  code: string,
  message: string,
  type = "invalid_request_error",
  extraHeaders?: Record<string, string>,
) {
  return NextResponse.json(
    { error: { message, type, code } },
    {
      status,
      headers: { ...CORS_HEADERS, "Cache-Control": "no-store", ...extraHeaders },
    },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Body check for the model chain (see the validateResponse hook
 * in lib/server/openrouter.ts): a completion counts only when
 * its first choice carries actual answer text — a string with
 * non-whitespace content, or a content-parts array holding at
 * least one non-empty text part. An unparsable body counts as
 * usable here; the caller's own JSON parse below reports that
 * failure properly instead of silently retrying every model.
 */
async function hasUsableCompletionContent(response: Response): Promise<boolean> {
  const payload = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown } }[];
  } | null;
  if (!payload) return true;
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim().length > 0;
  if (Array.isArray(content)) {
    return content.some((part) => {
      const text = (part as { text?: unknown } | null)?.text;
      return typeof text === "string" && text.trim().length > 0;
    });
  }
  return false;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function geo(request: NextRequest): { city: string | null; country: string | null } {
  const city = request.headers.get("x-vercel-ip-city");
  const country = request.headers.get("x-vercel-ip-country");
  return {
    city: city ? decodeURIComponent(city).slice(0, 100) : null,
    country: country ? country.slice(0, 4) : null,
  };
}

const ALLOWED_PARAMETERS = new Set([
  "model",
  "messages",
  "max_tokens",
  "temperature",
  "stream",
]);

export async function POST(request: NextRequest) {
  const identity = await authenticateApiKey(
    request.headers.get("authorization"),
  ).catch(() => null);
  if (!identity) {
    // Failed key attempts are throttled per IP so keys can't be
    // brute-force scanned against the auth lookup.
    try {
      const failures = await checkWindowLimit(
        `xyro:api:authfail:ip:${hashRateLimitKeyPart(getRemoteIp(request) ?? "unknown")}`,
        60 * 1000,
        30,
      );
      if (failures.state === "limited") {
        return apiError(
          429,
          "rate_limit_exceeded",
          "Too many failed API key attempts from this network. Wait a minute and try again.",
          "rate_limit_error",
          { "Retry-After": String(failures.retryAfter) },
        );
      }
    } catch {
      // Limiter trouble never changes the 401 below.
    }
    return apiError(
      401,
      "invalid_api_key",
      "Invalid or missing API key. Send your key as 'Authorization: Bearer xyro_sk_live_…'.",
      "authentication_error",
    );
  }

  // An orphaned key (developer access removed) stops working.
  const profile = await getDeveloperProfile(identity.uid).catch(() => null);
  if (!profile) {
    return apiError(
      401,
      "invalid_api_key",
      "This API key is no longer active.",
      "authentication_error",
    );
  }
  const context = getDeviceContext(request, undefined);
  const { city, country } = geo(request);

  // Account state: keys only work for enabled, email-verified
  // accounts — the same bar as sending messages in the app.
  try {
    const user = await getFirebaseAdminAuth().getUser(identity.uid);
    if (user.disabled) {
      return apiError(403, "account_disabled", "This account is disabled.", "authentication_error");
    }
    if (!user.emailVerified) {
      return apiError(
        403,
        "email_not_verified",
        "The account that owns this API key has not verified its email address.",
        "authentication_error",
      );
    }
  } catch {
    return apiError(503, "api_unavailable", "The API is temporarily unavailable.", "api_error");
  }

  // Per-key request rate limit (the daily token cap below is the
  // hard plan gate; this one smooths bursts).
  try {
    const limit = await checkWindowLimit(
      `xyro:api:key:${identity.keyId}`,
      60 * 1000,
      REQUESTS_PER_MINUTE_PER_KEY,
    );
    if (limit.state === "limited") {
      return apiError(
        429,
        "rate_limit_exceeded",
        "Too many requests from this API key. Slow down and try again shortly.",
        "rate_limit_error",
        { "Retry-After": String(limit.retryAfter) },
      );
    }
  } catch {
    // Limiter trouble never blocks a call on its own.
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return apiError(
      415,
      "unsupported_media_type",
      "Send the request with Content-Type: application/json.",
    );
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return apiError(400, "invalid_body", "The request body could not be read.");
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    return apiError(413, "body_too_large", "The request body is too large.");
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return apiError(400, "invalid_json", "The request body must be valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return apiError(400, "invalid_json", "The request body must be a JSON object.");
  }

  // Strict parameter surface: anything outside the documented set
  // is rejected by name instead of being silently ignored.
  for (const key of Object.keys(body)) {
    if (!ALLOWED_PARAMETERS.has(key)) {
      return apiError(
        400,
        "unknown_parameter",
        `Unknown parameter '${key}'. Supported parameters: model, messages, max_tokens, temperature, stream.`,
      );
    }
  }

  if (body.stream === true) {
    return apiError(
      400,
      "streaming_not_supported",
      "Streaming responses are not supported yet. Send the request without stream: true.",
    );
  }
  if (body.stream !== undefined && typeof body.stream !== "boolean") {
    return apiError(400, "invalid_parameter", "'stream' must be a boolean.");
  }

  let temperature: number | undefined;
  if (body.temperature !== undefined) {
    if (
      typeof body.temperature !== "number" ||
      !Number.isFinite(body.temperature) ||
      body.temperature < 0 ||
      body.temperature > 2
    ) {
      return apiError(400, "invalid_parameter", "'temperature' must be a number between 0 and 2.");
    }
    temperature = body.temperature;
  }

  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0 || rawMessages.length > MAX_MESSAGES) {
    return apiError(400, "invalid_messages", `Send between 1 and ${MAX_MESSAGES} messages.`);
  }
  const messages: ChatMessage[] = [];
  for (const item of rawMessages) {
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item) ||
      Object.keys(item).some((key) => key !== "role" && key !== "content") ||
      !("role" in item) ||
      !("content" in item) ||
      (item.role !== "system" && item.role !== "user" && item.role !== "assistant") ||
      typeof item.content !== "string" ||
      item.content.length === 0 ||
      item.content.length > MAX_CONTENT_CHARS
    ) {
      return apiError(
        400,
        "invalid_messages",
        "Each message must be an object with only a role (system, user or assistant) and non-empty string content.",
      );
    }
    messages.push({ role: item.role, content: item.content });
  }

  if (body.model !== undefined && typeof body.model !== "string") {
    return apiError(400, "invalid_parameter", "'model' must be a string.");
  }
  const requestedModel =
    typeof body.model === "string" && body.model.length > 0 ? body.model : AUTO_MODEL_ID;
  if (requestedModel !== AUTO_MODEL_ID && !(await isAllowedFreeModel(requestedModel))) {
    return apiError(
      400,
      "model_not_available",
      `Model '${requestedModel}' is not available on the free plan. Call GET /api/v1/models for the current list.`,
    );
  }
  if (body.max_tokens !== undefined && !Number.isInteger(body.max_tokens)) {
    return apiError(400, "invalid_parameter", "'max_tokens' must be an integer.");
  }
  const maxTokens =
    typeof body.max_tokens === "number"
      ? Math.min(4096, Math.max(1, body.max_tokens))
      : 1024;

  // Free-plan daily token limit, enforced from the Firestore rollup.
  const usageBefore = await getDailyUsage(identity.uid, apiDateKey()).catch(
    () => null,
  );
  if (usageBefore && usageBefore.totalTokens >= FREE_PLAN_DAILY_TOKEN_LIMIT) {
    await recordApiCall(identity.uid, {
      keyId: identity.keyId,
      keyPrefix: identity.displayPrefix,
      keyName: identity.keyName,
      endpoint: "chat/completions",
      model: requestedModel,
      status: "rejected",
      httpStatus: 429,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      tokensEstimated: false,
      context,
      city,
      country,
      input: messages,
      output: null,
    });
    return apiError(
      429,
      "daily_token_limit_exceeded",
      `The free plan daily limit of ${FREE_PLAN_DAILY_TOKEN_LIMIT.toLocaleString("en-US")} tokens has been reached. It resets at midnight UTC.`,
      "rate_limit_error",
    );
  }

  const apiKey = serverEnv.openRouterApiKey;
  if (!apiKey) {
    return apiError(503, "api_unavailable", "The API is not configured on this deployment.", "api_error");
  }

  const attempts = modelAttemptOrder(requestedModel);
  // The chain roams every configured provider — OpenRouter,
  // Groq, Gemini, SambaNova, NVIDIA, Cloudflare — so an answer
  // can come from whichever provider responds first with real
  // content. The one exception is the key owner's own privacy
  // switch: "Only use OpenRouter" (Settings → Data controls)
  // is honoured by the API exactly as it is by the app.
  let openRouterOnly = false;
  try {
    openRouterOnly = (await readPreferences(identity.uid)).openRouterOnly;
  } catch {
    openRouterOnly = false;
  }
  let upstream: Response;
  let usedAttemptModel = requestedModel;
  try {
    const completion = await fetchChatCompletionWithFallback({
      apiKey,
      attempts,
      messages,
      stream: false,
      maxTokens,
      temperature,
      signal: request.signal,
      referer: request.nextUrl.origin,
      title: "Xyro AI API",
      connectTimeoutMs: 25_000,
      openRouterOnly,
      // An HTTP 200 with no answer text is a FAILED attempt, not
      // a success: free models return empty completions often
      // (reasoning spent the whole token budget, empty choices,
      // null content). The chain must fall through to the next
      // model, and an empty answer must never be metered as a
      // successful, token-billed call — developers were seeing
      // "No response received from model" in their apps while
      // their dashboards showed token cost (fixed 2026-11-18).
      validateResponse: hasUsableCompletionContent,
    });
    upstream = completion.response;
    usedAttemptModel = completion.model;
  } catch (error) {
    if (error instanceof OpenRouterAttemptsExhausted) {
      const status = error.lastStatus === 429 ? 429 : 502;
      await recordApiCall(identity.uid, {
        keyId: identity.keyId,
        keyPrefix: identity.displayPrefix,
      keyName: identity.keyName,
        endpoint: "chat/completions",
        model: attempts[attempts.length - 1],
        status: "error",
        httpStatus: status,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        tokensEstimated: false,
        context,
        city,
        country,
        input: messages,
        output: null,
      });
      if (error.lastErrorBody === "EMPTY_COMPLETION") {
        await logEvent(
          "warn",
          "API chat/completions → 502 · every model returned an empty response (not charged)",
        );
        return apiError(
          502,
          "model_empty_response",
          "Every available model returned an empty response. You have not been charged for this call — please try again in a moment.",
          "api_error",
        );
      }
      return apiError(
        status,
        status === 429 ? "model_busy" : "model_unavailable",
        status === 429
          ? "Free models are busy right now. Please wait a moment and try again."
          : "The model service is temporarily unavailable.",
        status === 429 ? "rate_limit_error" : "api_error",
      );
    }
    return apiError(502, "model_unavailable", "The model service is temporarily unavailable.", "api_error");
  }
  if (!upstream.ok) {
    await upstream.body?.cancel().catch(() => undefined);
    await recordApiCall(identity.uid, {
      keyId: identity.keyId,
      keyPrefix: identity.displayPrefix,
      keyName: identity.keyName,
      endpoint: "chat/completions",
      model: usedAttemptModel,
      status: "error",
      httpStatus: 502,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      tokensEstimated: false,
      context,
      city,
      country,
      input: messages,
      output: null,
    });
    return apiError(502, "model_request_failed", "The model couldn’t process this request.", "api_error");
  }

  const result = (await upstream.json().catch(() => null)) as {
    model?: string;
    choices?: {
      message?: { role?: string; content?: string };
      finish_reason?: string;
    }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  } | null;
  if (!result) {
    await recordApiCall(identity.uid, {
      keyId: identity.keyId,
      keyPrefix: identity.displayPrefix,
      keyName: identity.keyName,
      endpoint: "chat/completions",
      model: usedAttemptModel,
      status: "error",
      httpStatus: 502,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      tokensEstimated: false,
      context,
      city,
      country,
      input: messages,
      output: null,
    });
    return apiError(502, "model_request_failed", "The model returned a response that couldn’t be read.", "api_error");
  }
  const content = result?.choices?.[0]?.message?.content ?? "";
  const usedModel = typeof result?.model === "string" ? result.model : requestedModel;

  // Last line of defence (the chain's validateResponse hook
  // normally catches this first): an empty answer is an error,
  // recorded with ZERO billed tokens — never a "success" the
  // developer's dashboard charges for while their app shows
  // "No response received from model".
  if (content.trim().length === 0) {
    await recordApiCall(identity.uid, {
      keyId: identity.keyId,
      keyPrefix: identity.displayPrefix,
      keyName: identity.keyName,
      endpoint: "chat/completions",
      model: usedModel,
      status: "error",
      httpStatus: 502,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      tokensEstimated: false,
      context,
      city,
      country,
      input: messages,
      output: null,
    });
    return apiError(
      502,
      "model_empty_response",
      "The model returned an empty response. You have not been charged for this call — please try again in a moment.",
      "api_error",
    );
  }

  let promptTokens = result?.usage?.prompt_tokens;
  let completionTokens = result?.usage?.completion_tokens;
  let totalTokens = result?.usage?.total_tokens;
  let tokensEstimated = false;
  if (
    typeof promptTokens !== "number" ||
    typeof completionTokens !== "number" ||
    typeof totalTokens !== "number"
  ) {
    promptTokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
    completionTokens = estimateTokens(content);
    totalTokens = promptTokens + completionTokens;
    tokensEstimated = true;
  }

  await recordApiCall(identity.uid, {
    keyId: identity.keyId,
    keyPrefix: identity.displayPrefix,
      keyName: identity.keyName,
    endpoint: "chat/completions",
    model: usedModel,
    status: "success",
    httpStatus: 200,
    promptTokens,
    completionTokens,
    totalTokens,
    tokensEstimated,
    context,
    city,
    country,
    input: messages,
    output: content,
  });
  void recordBudget({ firestoreWrites: 5, firestoreReads: 4 }).catch(
    () => undefined,
  );
  await logEvent(
    "info",
    `API chat/completions → 200 · ${usedModel} · ${totalTokens} tokens`,
  );

  return NextResponse.json(
    {
      id: `chatcmpl-${randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: usedModel,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: result?.choices?.[0]?.finish_reason ?? "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
    },
    { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } },
  );
}

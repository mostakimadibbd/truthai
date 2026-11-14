import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 12_000;
const MAX_TOTAL_LENGTH = 36_000;

function errorResponse(status: number, code: string, message: string, headers?: HeadersInit) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

function parseMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) return null;
  const messages: ChatMessage[] = [];
  let totalLength = 0;

  for (const item of value) {
    if (
      typeof item !== "object" ||
      item === null ||
      !("role" in item) ||
      (item.role !== "user" && item.role !== "assistant") ||
      !("content" in item) ||
      typeof item.content !== "string" ||
      item.content.trim().length === 0 ||
      item.content.length > MAX_MESSAGE_LENGTH
    ) {
      return null;
    }

    totalLength += item.content.length;
    if (totalLength > MAX_TOTAL_LENGTH) return null;
    messages.push({ role: item.role, content: item.content });
  }

  return messages.at(-1)?.role === "user" ? messages : null;
}

async function verifyUser(idToken: string): Promise<"valid" | "unverified" | "invalid"> {
  const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!firebaseApiKey) return "invalid";

  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
        cache: "no-store",
      },
    );
    if (!response.ok) return "invalid";
    const result: unknown = await response.json();
    if (
      typeof result !== "object" ||
      result === null ||
      !("users" in result) ||
      !Array.isArray(result.users) ||
      typeof result.users[0] !== "object" ||
      result.users[0] === null ||
      !("emailVerified" in result.users[0])
    ) {
      return "invalid";
    }
    return result.users[0].emailVerified === true ? "valid" : "unverified";
  } catch {
    return "invalid";
  }
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "This request origin isn’t allowed.");
  }

  const authorization = request.headers.get("authorization");
  const idToken = authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (!idToken || idToken.length > 10_000) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in to use chat.");
  }

  const verification = await verifyUser(idToken);
  if (verification === "invalid") {
    return errorResponse(401, "AUTH_INVALID", "Your session has expired. Sign in again.");
  }
  if (verification === "unverified") {
    return errorResponse(403, "EMAIL_NOT_VERIFIED", "Verify your email before using chat.");
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return errorResponse(
      503,
      "CHAT_NOT_CONFIGURED",
      "AI chat isn’t configured yet. Add an OpenRouter API key on the server to enable responses.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "The chat request isn’t valid JSON.");
  }

  const messages =
    typeof body === "object" && body !== null && "messages" in body
      ? parseMessages(body.messages)
      : null;
  if (!messages) {
    return errorResponse(
      400,
      "INVALID_MESSAGES",
      "Send up to 30 non-empty text messages, with your message last.",
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": request.nextUrl.origin,
        "X-Title": "Xyro AI",
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages,
        stream: true,
        max_tokens: 2048,
      }),
      signal: request.signal,
      cache: "no-store",
    });
  } catch {
    return errorResponse(502, "MODEL_UNAVAILABLE", "The free model service is temporarily unavailable.");
  }

  if (!upstream.ok || !upstream.body) {
    const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 503 : 502;
    const headers: HeadersInit = {};
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) headers["Retry-After"] = retryAfter;
    return errorResponse(
      status,
      status === 429 ? "MODEL_BUSY" : "MODEL_REQUEST_FAILED",
      status === 429
        ? "Free models are busy right now. Please wait a moment and try again."
        : "The model couldn’t complete this request. Please try again.",
      headers,
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Shared OpenRouter calling discipline for the chat route and the
 * public API. Free models rate-limit (429), return 5xx and drop
 * connections constantly, so every call walks the fallback chain
 * from modelAttemptOrder with backoff between attempts:
 *
 *  - each attempt gets its own connect timeout (time to response
 *    headers); the response body is the caller's to manage, so a
 *    long streamed reply is never killed by the connect budget;
 *  - 429/5xx and network errors move to the next model after a
 *    short backoff (honouring Retry-After, capped);
 *  - a non-retryable HTTP status (e.g. 400) is returned to the
 *    caller immediately for mapping;
 *  - when every attempt fails retryably, an
 *    OpenRouterAttemptsExhausted error carries the last status so
 *    the caller can answer 429-vs-502 correctly.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Backoff before the next attempt: Retry-After wins, capped at 5s. */
export function retryDelayMs(
  attemptIndex: number,
  retryAfterHeader: string | null,
): number {
  if (retryAfterHeader) {
    const seconds = Number.parseFloat(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(5000, Math.max(250, seconds * 1000));
    }
  }
  const base = 700 * 2 ** attemptIndex;
  const jitter = Math.floor(Math.random() * 300);
  return Math.min(4000, base + jitter);
}

export class OpenRouterAttemptsExhausted extends Error {
  readonly lastStatus: number | null;
  readonly retryAfter: string | null;

  constructor(lastStatus: number | null, retryAfter: string | null) {
    super("Every OpenRouter model attempt failed.");
    this.name = "OpenRouterAttemptsExhausted";
    this.lastStatus = lastStatus;
    this.retryAfter = retryAfter;
  }
}

export type ChatCompletionArgs = {
  apiKey: string;
  attempts: string[];
  messages: unknown;
  stream: boolean;
  maxTokens?: number;
  temperature?: number;
  modalities?: string[];
  /** The end user's request signal (client disconnect / stop). */
  signal?: AbortSignal;
  referer: string;
  title: string;
  /** Per-attempt budget for response headers. Default 25s. */
  connectTimeoutMs?: number;
};

export async function fetchChatCompletionWithFallback(
  args: ChatCompletionArgs,
): Promise<{ response: Response; model: string }> {
  const connectTimeoutMs = args.connectTimeoutMs ?? 25_000;
  let lastStatus: number | null = null;
  let lastRetryAfter: string | null = null;

  for (let index = 0; index < args.attempts.length; index += 1) {
    const model = args.attempts[index];
    if (args.signal?.aborted) {
      throw new OpenRouterAttemptsExhausted(lastStatus, lastRetryAfter);
    }
    const attemptController = new AbortController();
    const connectTimer = setTimeout(
      () => attemptController.abort(),
      connectTimeoutMs,
    );
    const signal = args.signal
      ? AbortSignal.any([args.signal, attemptController.signal])
      : attemptController.signal;

    let response: Response;
    try {
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${args.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": args.referer,
          "X-Title": args.title,
        },
        body: JSON.stringify({
          model,
          messages: args.messages,
          stream: args.stream,
          ...(args.maxTokens !== undefined
            ? { max_tokens: args.maxTokens }
            : {}),
          ...(args.temperature !== undefined
            ? { temperature: args.temperature }
            : {}),
          ...(args.modalities !== undefined
            ? { modalities: args.modalities }
            : {}),
        }),
        signal,
        cache: "no-store",
      });
    } catch (error) {
      clearTimeout(connectTimer);
      if (args.signal?.aborted) throw error;
      // Network error or connect timeout: try the next model.
      lastStatus = null;
      if (index < args.attempts.length - 1) {
        await sleep(retryDelayMs(index, null));
        continue;
      }
      throw new OpenRouterAttemptsExhausted(null, null);
    }
    clearTimeout(connectTimer);

    if (response.ok) {
      return { response, model };
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable) {
      return { response, model };
    }
    lastStatus = response.status;
    lastRetryAfter = response.headers.get("retry-after");
    await response.body?.cancel().catch(() => undefined);
    if (index < args.attempts.length - 1) {
      await sleep(retryDelayMs(index, lastRetryAfter));
      continue;
    }
    throw new OpenRouterAttemptsExhausted(lastStatus, lastRetryAfter);
  }

  throw new OpenRouterAttemptsExhausted(lastStatus, lastRetryAfter);
}

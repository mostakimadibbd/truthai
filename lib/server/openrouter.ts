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
 *  - per-model rejections (400 invalid for this provider, 404 no
 *    endpoint, 413/422 too large / unprocessable) ALSO move to the
 *    next model — one strict or small-context free model must not
 *    kill a request the next model would happily answer (this was
 *    the production "The model couldn't process this request"
 *    failure: the chain used to return the first 400 immediately);
 *  - account-level statuses (401/403/402) are returned to the
 *    caller immediately — every model would fail the same way;
 *  - when every attempt fails retryably, an
 *    OpenRouterAttemptsExhausted error carries the last status and
 *    the last upstream error body so the failure is diagnosable.
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
  readonly lastErrorBody: string | null;

  constructor(
    lastStatus: number | null,
    retryAfter: string | null,
    lastErrorBody: string | null = null,
  ) {
    super("Every OpenRouter model attempt failed.");
    this.name = "OpenRouterAttemptsExhausted";
    this.lastStatus = lastStatus;
    this.retryAfter = retryAfter;
    this.lastErrorBody = lastErrorBody;
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
  /** Ask OpenRouter to include token usage in the stream's final chunk. */
  includeUsage?: boolean;
};

/**
 * FREE-ONLY GUARD (owner requirement: the OpenRouter account has
 * no credit, so a paid call must be impossible, not just unlikely).
 * Every attempt is checked at this single choke point — chat and
 * the public API both flow through here. An attempt survives only
 * if it is the free router or a `:free` model variant; anything
 * else is dropped and logged. (Verified against the live
 * catalogue: the only $0-priced models without the suffix are two
 * music models and the router itself — no chat model is lost.)
 */
export function freeOnlyAttempts(attempts: string[]): string[] {
  const kept = attempts.filter(
    (id) => id === "openrouter/free" || id.endsWith(":free"),
  );
  const dropped = attempts.filter((id) => !kept.includes(id));
  if (dropped.length) {
    console.error(`Free-only guard dropped non-free model attempts: ${dropped.join(", ")}`);
  }
  return kept.length ? kept : ["openrouter/free"];
}

export async function fetchChatCompletionWithFallback(
  args: ChatCompletionArgs,
): Promise<{ response: Response; model: string }> {
  args = { ...args, attempts: freeOnlyAttempts(args.attempts) };
  const connectTimeoutMs = args.connectTimeoutMs ?? 25_000;
  let lastStatus: number | null = null;
  let lastRetryAfter: string | null = null;
  let lastErrorBody: string | null = null;

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
          ...(args.includeUsage ? { usage: { include: true } } : {}),
        }),
        signal,
        cache: "no-store",
      });
    } catch (error) {
      clearTimeout(connectTimer);
      if (args.signal?.aborted) throw error;
      // Network error or connect timeout: try the next model.
      lastStatus = null;
      lastErrorBody = error instanceof Error ? error.message.slice(0, 500) : null;
      if (index < args.attempts.length - 1) {
        await sleep(retryDelayMs(index, null));
        continue;
      }
      throw new OpenRouterAttemptsExhausted(null, null, lastErrorBody);
    }
    clearTimeout(connectTimer);

    if (response.ok) {
      return { response, model };
    }

    const retryable =
      response.status === 429 ||
      response.status >= 500 ||
      response.status === 400 ||
      response.status === 404 ||
      response.status === 413 ||
      response.status === 422;
    if (!retryable) {
      return { response, model };
    }
    lastStatus = response.status;
    lastRetryAfter = response.headers.get("retry-after");
    // Read the upstream error body before discarding it: it says
    // exactly why the model refused (context length, invalid
    // message, no endpoints) and is the only way these failures
    // are diagnosable from logs.
    lastErrorBody = await response
      .text()
      .then((text) => text.slice(0, 500))
      .catch(() => null);
    console.error(
      `OpenRouter attempt failed: model=${model} status=${response.status} body=${lastErrorBody ?? ""}`,
    );
    if (index < args.attempts.length - 1) {
      await sleep(retryDelayMs(index, lastRetryAfter));
      continue;
    }
    throw new OpenRouterAttemptsExhausted(lastStatus, lastRetryAfter, lastErrorBody);
  }

  throw new OpenRouterAttemptsExhausted(lastStatus, lastRetryAfter, lastErrorBody);
}

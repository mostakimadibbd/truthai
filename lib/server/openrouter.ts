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

/**
 * Cross-provider free tiers (2026-11-17 robustness round).
 * OpenRouter's no-credit free quota (~50 requests/day) is the
 * product's single biggest bottleneck, so when the owner adds a
 * free-tier key for another provider, the fallback chain extends
 * across providers after the OpenRouter attempts: a completely
 * separate quota pool catches the turn when OpenRouter is dry.
 * Every provider here is OpenAI-compatible and free-tier only —
 * the model lists are hard allowlists, so a key can never be
 * used to call a paid model through this path. Keys are read
 * from the environment; no key, no targets, no behaviour change.
 */
export type AttemptTarget = {
  provider: string;
  model: string;
  /** What gets recorded as the used model (provider-prefixed off OpenRouter). */
  label: string;
  url: string;
  apiKey: string;
};

type ProviderSpec = {
  provider: string;
  url: string;
  envKeys: string[];
  models: string[];
};

const CROSS_PROVIDERS: ProviderSpec[] = [
  {
    provider: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY"],
    models: ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
  },
  {
    provider: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    envKeys: ["GROQ_API_KEY"],
    models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.1-8b-instant"],
  },
  {
    provider: "mistral",
    url: "https://api.mistral.ai/v1/chat/completions",
    envKeys: ["MISTRAL_API_KEY"],
    models: ["mistral-small-latest", "open-mistral-nemo"],
  },
  {
    provider: "huggingface",
    url: "https://router.huggingface.co/v1/chat/completions",
    envKeys: ["HF_TOKEN", "HUGGINGFACE_API_KEY"],
    models: ["Qwen/Qwen3-235B-A22B", "meta-llama/Llama-3.3-70B-Instruct"],
  },
];

export function crossProviderTargets(
  env: Record<string, string | undefined> = process.env,
): AttemptTarget[] {
  const targets: AttemptTarget[] = [];
  for (const spec of CROSS_PROVIDERS) {
    const apiKey = spec.envKeys
      .map((name) => env[name]?.trim())
      .find((value) => value);
    if (!apiKey) continue;
    for (const model of spec.models) {
      targets.push({
        provider: spec.provider,
        model,
        label: `${spec.provider}/${model}`,
        url: spec.url,
        apiKey,
      });
    }
  }
  return targets;
}

export function buildAttemptTargets(
  openRouterAttempts: string[],
  openRouterApiKey: string,
  env: Record<string, string | undefined> = process.env,
): AttemptTarget[] {
  const targets: AttemptTarget[] = openRouterAttempts.map((model) => ({
    provider: "openrouter",
    model,
    label: model,
    url: "https://openrouter.ai/api/v1/chat/completions",
    apiKey: openRouterApiKey,
  }));
  return [...targets, ...crossProviderTargets(env)];
}

export async function fetchChatCompletionWithFallback(
  args: ChatCompletionArgs,
): Promise<{ response: Response; model: string }> {
  args = { ...args, attempts: freeOnlyAttempts(args.attempts) };
  const targets = buildAttemptTargets(args.attempts, args.apiKey);
  const connectTimeoutMs = args.connectTimeoutMs ?? 25_000;
  let lastStatus: number | null = null;
  let lastRetryAfter: string | null = null;
  let lastErrorBody: string | null = null;

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const model = target.model;
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
      response = await fetch(target.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${target.apiKey}`,
          "Content-Type": "application/json",
          // Referer/title attribution headers are OpenRouter's
          // convention; other providers reject unknown headers
          // inconsistently, so they are only sent there.
          ...(target.provider === "openrouter"
            ? { "HTTP-Referer": args.referer, "X-Title": args.title }
            : {}),
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
          ...(args.modalities !== undefined && target.provider === "openrouter"
            ? { modalities: args.modalities }
            : {}),
          ...(args.includeUsage && target.provider === "openrouter"
            ? { usage: { include: true } }
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
      lastErrorBody = error instanceof Error ? error.message.slice(0, 500) : null;
      if (index < targets.length - 1) {
        await sleep(retryDelayMs(index, null));
        continue;
      }
      throw new OpenRouterAttemptsExhausted(null, null, lastErrorBody);
    }
    clearTimeout(connectTimer);

    if (response.ok) {
      return { response, model: target.label };
    }

    const retryable =
      response.status === 429 ||
      response.status >= 500 ||
      response.status === 400 ||
      response.status === 404 ||
      response.status === 413 ||
      response.status === 422 ||
      // Account-level statuses end the chain on OpenRouter (one
      // account, every model fails the same), but a bad or
      // exhausted key at one cross-provider must not stop the
      // others from answering.
      (target.provider !== "openrouter" &&
        (response.status === 401 ||
          response.status === 402 ||
          response.status === 403));
    if (!retryable) {
      return { response, model: target.label };
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
      `Model attempt failed: target=${target.label} status=${response.status} body=${lastErrorBody ?? ""}`,
    );
    if (index < targets.length - 1) {
      await sleep(retryDelayMs(index, lastRetryAfter));
      continue;
    }
    throw new OpenRouterAttemptsExhausted(lastStatus, lastRetryAfter, lastErrorBody);
  }

  throw new OpenRouterAttemptsExhausted(lastStatus, lastRetryAfter, lastErrorBody);
}

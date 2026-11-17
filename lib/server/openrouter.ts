import { serverEnv } from "./env";
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
  /** Walk cross-provider targets (Groq, Gemini, …) BEFORE the
   * OpenRouter attempts. Used by the refusal retry: when a model
   * answers with an access-denial refusal (an HTTP 200 the chain
   * cannot correct), the turn is re-asked provider-first so a
   * different provider's model answers instead. */
  providersFirst?: boolean;
  /** Move this provider's targets to the front of the chain (the
   * model modes: Fast prefers Groq, Lightweight prefers
   * Cloudflare). Everything else remains as fallback. */
  preferredProvider?: string;
  /** The user's "Only use OpenRouter" privacy switch: when true
   * the chain contains OpenRouter attempts ONLY — no other
   * provider can receive the prompt, file content or memory
   * text for this turn. */
  openRouterOnly?: boolean;
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
  /** Fixed endpoint, or a builder for endpoints that embed an
   * account id (Cloudflare). A builder returning null skips the
   * provider (e.g. token present but account id missing). */
  url: string | ((env: Record<string, string | undefined>) => string | null);
  envKeys: string[];
  models: string[];
  /** Subset of models that can actually SEE image attachments.
   * Turns carrying images only ever target these — a text-only
   * model must never be handed pictures it cannot perceive. */
  visionModels?: string[];
};

const CROSS_PROVIDERS: ProviderSpec[] = [
  {
    provider: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY"],
    models: ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    visionModels: ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
  },
  {
    provider: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    envKeys: ["GROQ_API_KEY"],
    models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"],
  },
  {
    provider: "requesty",
    url: "https://router.requesty.ai/v1/chat/completions",
    envKeys: ["REQUESTY_API_KEY"],
    models: [
      "nvidia/nemotron-3-ultra-550b-a55b",
      "google/gemma-4-31b-it",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
    ],
    visionModels: ["google/gemma-4-31b-it"],
  },
  {
    provider: "sambanova",
    url: "https://api.sambanova.ai/v1/chat/completions",
    envKeys: ["SAMBANOVA_API_KEY"],
    models: ["DeepSeek-V3.1", "Meta-Llama-3.3-70B-Instruct", "gpt-oss-120b"],
  },
  {
    provider: "nvidia",
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    envKeys: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"],
    models: [
      "meta/llama-3.3-70b-instruct",
      "openai/gpt-oss-120b",
      "deepseek-ai/deepseek-v4-flash",
    ],
  },
  {
    // Cloudflare Workers AI (OpenAI-compatible endpoint). Powers
    // the "Lightweight" mode and the image-generation chain; the
    // free allocation needs no card. Needs BOTH the account id
    // (in the URL) and an API token with Workers AI permission.
    provider: "cloudflare",
    url: (env) => {
      const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
      return accountId
        ? `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`
        : null;
    },
    envKeys: ["CLOUDFLARE_API_TOKEN"],
    models: [
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      "@cf/openai/gpt-oss-120b",
      "@cf/meta/llama-4-scout-17b-16e-instruct",
    ],
    visionModels: ["@cf/meta/llama-4-scout-17b-16e-instruct"],
  },
];

export function crossProviderTargets(
  env: Record<string, string | undefined> = serverEnv.providerEnv(),
  visionOnly = false,
): AttemptTarget[] {
  const targets: AttemptTarget[] = [];
  for (const spec of CROSS_PROVIDERS) {
    const apiKey = spec.envKeys
      .map((name) => env[name]?.trim())
      .find((value) => value);
    if (!apiKey) continue;
    const url = typeof spec.url === "function" ? spec.url(env) : spec.url;
    if (!url) continue;
    const models = visionOnly ? (spec.visionModels ?? []) : spec.models;
    for (const model of models) {
      targets.push({
        provider: spec.provider,
        model,
        label: `${spec.provider}/${model}`,
        url,
        apiKey,
      });
    }
  }
  return targets;
}

export function buildAttemptTargets(
  openRouterAttempts: string[],
  openRouterApiKey: string,
  env: Record<string, string | undefined> = serverEnv.providerEnv(),
  visionOnly = false,
  providersFirst = false,
  preferredProvider?: string,
  openRouterOnly = false,
): AttemptTarget[] {
  const targets: AttemptTarget[] = openRouterAttempts.map((model) => ({
    provider: "openrouter",
    model,
    label: model,
    url: "https://openrouter.ai/api/v1/chat/completions",
    apiKey: openRouterApiKey,
  }));
  // "Only use OpenRouter" (the user's privacy switch): the chain
  // is OpenRouter attempts alone — cross-provider targets are
  // never built, so nothing can be sent to another provider.
  const cross = openRouterOnly ? [] : crossProviderTargets(env, visionOnly);
  let ordered = providersFirst
    ? [...cross, ...targets]
    : [...targets, ...cross];
  // Model modes (Fast / Lightweight) prefer one provider: its
  // targets move to the front, everything else keeps its order as
  // fallback. A preference for an unconfigured provider is a no-op.
  if (preferredProvider) {
    ordered = [
      ...ordered.filter((target) => target.provider === preferredProvider),
      ...ordered.filter((target) => target.provider !== preferredProvider),
    ];
  }
  return ordered;
}

const REFUSAL_PATTERNS: RegExp[] = [
  /\bi (?:can'?t|cannot|can not) browse\b/,
  /\bi (?:can'?t|cannot|can not) access the (?:internet|web)\b/,
  /\bi (?:don'?t|do not) have (?:access to )?(?:the )?(?:internet|web|real[- ]?time|browsing)\b/,
  /\bi (?:don'?t|do not) have browsing\b/,
  /\bi'?m unable to (?:browse|access)\b/,
  /\bi am unable to (?:browse|access)\b/,
  /\bas an ai language model\b/,
  /\bno (?:internet|browsing) access\b/,
];

/**
 * True when a reply opens with an access-denial refusal — the weak
 * free-model habit of claiming it cannot browse or reach the
 * internet (often while search results sit in its context). Only
 * the head of the reply is judged, and only this specific refusal
 * class: a different provider's model usually just answers, so the
 * chat route retries provider-first when this fires. Genuine
 * answers and policy refusals (which every provider would repeat)
 * are deliberately not matched.
 */
export function looksLikeRefusal(text: string): boolean {
  const head = text.slice(0, 400).toLowerCase();
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(head));
}

/** True when any message carries an image content part. */
export function messagesHaveImages(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some((message) => {
    const content = (message as { content?: unknown })?.content;
    return (
      Array.isArray(content) &&
      content.some(
        (part) => (part as { type?: unknown })?.type === "image_url",
      )
    );
  });
}

export async function fetchChatCompletionWithFallback(
  args: ChatCompletionArgs,
): Promise<{ response: Response; model: string; provider: string }> {
  args = { ...args, attempts: freeOnlyAttempts(args.attempts) };
  // Media turns: cross-provider attempts are restricted to models
  // that can see images, so an uploaded photo is always analysed by
  // a vision model even when OpenRouter's quota is exhausted.
  const targets = buildAttemptTargets(
    args.attempts,
    args.apiKey,
    serverEnv.providerEnv(),
    messagesHaveImages(args.messages),
    args.providersFirst ?? false,
    args.preferredProvider,
    args.openRouterOnly ?? false,
  );
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
      return { response, model: target.label, provider: target.provider };
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
      return { response, model: target.label, provider: target.provider };
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

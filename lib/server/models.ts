// Free-model catalogue for Xyro AI, backed by OpenRouter.
//
// GET /api/models serves this list; /api/chat validates the requested
// model against it. The live list comes from OpenRouter's public
// /api/v1/models endpoint, filtered to models whose prompt AND
// completion pricing are both 0 (genuinely free — the free tier must
// never silently bill). Results are cached in server memory for 10
// minutes. When OpenRouter is unreachable or no key is configured, a
// small static fallback of long-running free models is served instead
// (flagged with source: "fallback") so the picker and settings still
// work; chat itself still requires a key.

export type FreeModel = {
  id: string;
  name: string;
  contextLength: number | null;
  capabilities: string[];
};

export type FreeImageModel = {
  id: string;
  name: string;
};

export const AUTO_MODEL_ID = "openrouter/free";

const FALLBACK_MODELS: FreeModel[] = [
  { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (free)", contextLength: 131072, capabilities: ["text"] },
  { id: "google/gemma-3-27b-it:free", name: "Gemma 3 27B (free)", contextLength: 131072, capabilities: ["text", "vision"] },
  { id: "deepseek/deepseek-chat-v3-0324:free", name: "DeepSeek V3 (free)", contextLength: 163840, capabilities: ["text"] },
  { id: "qwen/qwen3-235b-a22b:free", name: "Qwen3 235B (free)", contextLength: 131072, capabilities: ["text"] },
  { id: "mistralai/mistral-small-3.1-24b-instruct:free", name: "Mistral Small 3.1 (free)", contextLength: 128000, capabilities: ["text", "vision"] },
];

const CACHE_MS = 10 * 60 * 1000;
let cache: { models: FreeModel[]; source: "live" | "fallback"; expiresAt: number } | null =
  null;

// Raw OpenRouter catalogue, cached alongside the derived free list so
// the chat models and the image-generation models (Phase 7) share a
// single upstream fetch per 10-minute window.
let rawCache: {
  entries: Record<string, unknown>[];
  expiresAt: number;
} | null = null;

async function fetchRawCatalogue(): Promise<Record<string, unknown>[] | null> {
  if (rawCache && rawCache.expiresAt > Date.now()) {
    return rawCache.entries;
  }
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: unknown };
    if (!Array.isArray(payload.data)) return null;
    const entries = payload.data.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null,
    );
    rawCache = { entries, expiresAt: Date.now() + CACHE_MS };
    return entries;
  } catch (error) {
    console.error("OpenRouter model list unavailable.", error);
    return null;
  }
}

function isFreeEntry(model: Record<string, unknown>): boolean {
  const pricing = model.pricing as
    | { prompt?: unknown; completion?: unknown }
    | undefined;
  return (
    typeof model.id === "string" &&
    (model.id.endsWith(":free") ||
      (pricing?.prompt === "0" && pricing?.completion === "0"))
  );
}

function capabilitiesFor(model: Record<string, unknown>): string[] {
  const capabilities = ["text"];
  const architecture = model.architecture as
    | { input_modalities?: unknown }
    | undefined;
  const modalities = architecture?.input_modalities;
  if (Array.isArray(modalities) && modalities.includes("image")) {
    capabilities.push("vision");
  }
  return capabilities;
}

export async function getFreeModels(): Promise<{
  models: FreeModel[];
  source: "live" | "fallback";
}> {
  if (cache && cache.expiresAt > Date.now()) {
    return { models: cache.models, source: cache.source };
  }

  let models: FreeModel[] = FALLBACK_MODELS;
  let source: "live" | "fallback" = "fallback";
  const entries = await fetchRawCatalogue();
  if (entries) {
    const free = entries.flatMap((model) => {
      if (!isFreeEntry(model) || typeof model.id !== "string") return [];
      return [
        {
          id: model.id,
          name: typeof model.name === "string" ? model.name : model.id,
          contextLength:
            typeof model.context_length === "number"
              ? model.context_length
              : null,
          capabilities: capabilitiesFor(model),
        },
      ];
    });
    if (free.length > 0) {
      // Prefer the curated fallback entries first when they are
      // still free upstream (stable ordering for the picker), then
      // the rest alphabetically.
      const fallbackIds = new Set(FALLBACK_MODELS.map((m) => m.id));
      const curated = FALLBACK_MODELS.filter((fallback) =>
        free.some((model) => model.id === fallback.id),
      );
      const rest = free
        .filter((model) => !fallbackIds.has(model.id))
        .sort((a, b) => a.id.localeCompare(b.id));
      models = [...curated, ...rest].slice(0, 100);
      source = "live";
    }
  }

  cache = { models, source, expiresAt: Date.now() + CACHE_MS };
  return { models, source };
}

/**
 * Free models that can GENERATE images (Phase 7): free by the same
 * pricing rule as chat models, with "image" in the architecture's
 * output modalities. There is deliberately NO static fallback — if
 * the live catalogue can't be read, or no free image model is in it
 * right now, the list is empty and image creation reports itself
 * unavailable rather than guessing. (Checked live on 2026-11-15:
 * 13 image-output models existed on OpenRouter and ALL were paid,
 * so an empty list is the normal state until a provider frees one.)
 *
 * Test hook: XYRO_TEST_NO_IMAGE_MODELS=1 forces an empty list so the
 * unavailable path can be exercised locally. It is IGNORED in
 * production (VERCEL_ENV=production), mirroring the
 * XYRO_TEST_BUDGET_FS_WRITES pattern in lib/server/budget.ts.
 */
export async function getFreeImageModels(): Promise<FreeImageModel[]> {
  if (
    process.env.VERCEL_ENV !== "production" &&
    process.env.XYRO_TEST_NO_IMAGE_MODELS === "1"
  ) {
    return [];
  }
  const entries = await fetchRawCatalogue();
  if (!entries) return [];
  return entries.flatMap((model) => {
    if (!isFreeEntry(model) || typeof model.id !== "string") return [];
    const architecture = model.architecture as
      | { output_modalities?: unknown }
      | undefined;
    const outputs = architecture?.output_modalities;
    if (!Array.isArray(outputs) || !outputs.includes("image")) return [];
    return [
      {
        id: model.id,
        name: typeof model.name === "string" ? model.name : model.id,
      },
    ];
  });
}

/**
 * Pick a free vision-capable model for a request that carries image
 * attachments: curated fallback entries first (stable, known-good),
 * then the rest of the live list in order. Returns null when no free
 * vision model is available — the caller must then tell the user the
 * images can't be seen, never silently drop them.
 */
export function pickFreeVisionModel(models: FreeModel[]): FreeModel | null {
  const vision = models.filter(
    (model) => model.id !== AUTO_MODEL_ID && model.capabilities.includes("vision"),
  );
  if (vision.length === 0) return null;
  const curated = FALLBACK_MODELS.filter((fallback) =>
    vision.some((model) => model.id === fallback.id),
  );
  return curated[0] ?? vision[0];
}

export function modelHasVision(models: FreeModel[], modelId: string): boolean {
  return (
    models.find((model) => model.id === modelId)?.capabilities.includes(
      "vision",
    ) ?? false
  );
}

export async function isAllowedFreeModel(modelId: string): Promise<boolean> {
  if (modelId === AUTO_MODEL_ID) return true;
  const { models } = await getFreeModels();
  return models.some((model) => model.id === modelId);
}

/**
 * Ordered attempt list for a chat request: the requested model first,
 * then Auto (Free) as the safety net. /api/chat retries once against
 * the next entry on a 429/5xx from the previous one.
 */
export function modelAttemptOrder(requested: string): string[] {
  return requested === AUTO_MODEL_ID
    ? [AUTO_MODEL_ID]
    : [requested, AUTO_MODEL_ID];
}

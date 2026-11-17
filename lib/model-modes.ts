/**
 * The user-facing model modes. Users pick a MODE, never a provider:
 * the names say what the experience feels like, and the server maps
 * each mode to a preferred provider inside the fallback chain (the
 * chain still falls through to every configured provider, so a mode
 * whose preferred provider is unconfigured or busy simply answers
 * from the next one). Provider names never appear in the UI.
 *
 *   Fast       → Groq first (low-latency models)
 *   Thinking   → OpenRouter's strong curated models first
 *   Lightweight→ Cloudflare Workers AI first (small, efficient)
 */
export const MODEL_MODES = [
  {
    id: "fast",
    name: "Fast",
    description: "Quick answers for everyday questions and chat.",
  },
  {
    id: "thinking",
    name: "Thinking",
    description: "Deeper reasoning for hard questions, coding and analysis.",
  },
  {
    id: "lightweight",
    name: "Lightweight",
    description: "Light and efficient — great for simple, quick tasks.",
  },
] as const;

export type ModelModeId = (typeof MODEL_MODES)[number]["id"];

export const DEFAULT_MODEL_MODE_ID: ModelModeId = "fast";

export function isModelModeId(value: unknown): value is ModelModeId {
  return value === "fast" || value === "thinking" || value === "lightweight";
}

/** The provider a mode prefers inside the fallback chain. */
export function modePreferredProvider(mode: ModelModeId): string | undefined {
  if (mode === "fast") return "groq";
  if (mode === "lightweight") return "cloudflare";
  return undefined;
}

/** Display names for the providers that can answer a reply.
 * Used for the per-reply attribution ("via …") — the provider
 * itself is a fact users are entitled to see, even though the
 * model picker speaks in modes, not providers. */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openrouter: "OpenRouter",
  gemini: "Google Gemini",
  groq: "Groq",
  requesty: "Requesty",
  sambanova: "SambaNova",
  nvidia: "NVIDIA",
  cloudflare: "Cloudflare",
};

export function providerDisplayName(provider: string | null | undefined): string | null {
  if (!provider) return null;
  return PROVIDER_DISPLAY_NAMES[provider] ?? null;
}

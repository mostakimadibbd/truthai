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

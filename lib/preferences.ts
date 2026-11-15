// Shared (client-safe) preference schema for Xyro AI settings.
//
// Preferences live in Firestore at users/{uid}/settings/preferences and
// are written ONLY by the server (/api/settings). Clients read them via
// that API and via a read-only Firestore snapshot (rules allow owners to
// read, never write). This module is the single source of truth for the
// keys, defaults, enums and length caps; lib/server/settings.ts holds
// the strict server-side validation built on top of it.

export const TYPING_SPEEDS = ["slow", "normal", "fast", "instant"] as const;
export type TypingSpeed = (typeof TYPING_SPEEDS)[number];

export const THEMES = ["system", "dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

export type Preferences = {
  /** Colour theme: follow the device, or always dark / light. */
  theme: Theme;
  typingSpeed: TypingSpeed;
  /** true: Enter sends. false: only Cmd/Ctrl+Enter sends. */
  sendWithEnter: boolean;
  showSuggestions: boolean;
  /** OpenRouter model id, or "openrouter/free" for Auto (Free). */
  defaultModel: string;
  instructionsEnabled: boolean;
  instructionsAbout: string;
  instructionsStyle: string;
};

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  typingSpeed: "normal",
  sendWithEnter: true,
  showSuggestions: true,
  defaultModel: "openrouter/free",
  instructionsEnabled: false,
  instructionsAbout: "",
  instructionsStyle: "",
};

export const PREFERENCE_KEYS = Object.keys(
  DEFAULT_PREFERENCES,
) as (keyof Preferences)[];

export const MAX_INSTRUCTIONS_LENGTH = 1500;
export const MAX_MODEL_ID_LENGTH = 200;

/** Characters per second for the typewriter, per typing-speed setting. */
export const TYPING_SPEED_CPS: Record<Exclude<TypingSpeed, "instant">, number> = {
  slow: 60,
  normal: 180,
  fast: 600,
};

export function sanitizePreferences(value: unknown): Preferences {
  const source =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const typingSpeed = TYPING_SPEEDS.includes(
    source.typingSpeed as TypingSpeed,
  )
    ? (source.typingSpeed as TypingSpeed)
    : DEFAULT_PREFERENCES.typingSpeed;
  const theme = THEMES.includes(source.theme as Theme)
    ? (source.theme as Theme)
    : DEFAULT_PREFERENCES.theme;
  const stringOr = (key: string, fallback: string, max: number) =>
    typeof source[key] === "string"
      ? (source[key] as string).slice(0, max)
      : fallback;
  const boolOr = (key: string, fallback: boolean) =>
    typeof source[key] === "boolean" ? (source[key] as boolean) : fallback;
  return {
    theme,
    typingSpeed,
    sendWithEnter: boolOr("sendWithEnter", DEFAULT_PREFERENCES.sendWithEnter),
    showSuggestions: boolOr(
      "showSuggestions",
      DEFAULT_PREFERENCES.showSuggestions,
    ),
    defaultModel: stringOr(
      "defaultModel",
      DEFAULT_PREFERENCES.defaultModel,
      MAX_MODEL_ID_LENGTH,
    ),
    instructionsEnabled: boolOr(
      "instructionsEnabled",
      DEFAULT_PREFERENCES.instructionsEnabled,
    ),
    instructionsAbout: stringOr(
      "instructionsAbout",
      "",
      MAX_INSTRUCTIONS_LENGTH,
    ),
    instructionsStyle: stringOr(
      "instructionsStyle",
      "",
      MAX_INSTRUCTIONS_LENGTH,
    ),
  };
}

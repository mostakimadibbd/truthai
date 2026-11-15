import {
  MAX_INSTRUCTIONS_LENGTH,
  MAX_MODEL_ID_LENGTH,
  PREFERENCE_KEYS,
  THEMES,
  TYPING_SPEEDS,
  sanitizePreferences,
  type Preferences,
} from "@/lib/preferences";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";

// Server-side settings storage + strict validation.
//
// The preferences document users/{uid}/settings/preferences is written
// only from /api/settings (Firestore rules let owners read it but deny
// client writes). Validation is an allow-list: unknown keys, wrong
// types, unknown enum values and over-long strings are all rejected
// with a 400 before any Firestore or Admin work happens.

export const SETTINGS_SCHEMA_VERSION = 1;

const MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._\-/:]*$/;

export type PreferencesValidation =
  | { ok: true; patch: Partial<Preferences> }
  | { ok: false; message: string };

export function validatePreferencesPatch(
  body: Record<string, unknown>,
): PreferencesValidation {
  const keys = Object.keys(body);
  if (keys.length === 0) {
    return { ok: false, message: "Send at least one setting to update." };
  }
  for (const key of keys) {
    if (!(PREFERENCE_KEYS as string[]).includes(key)) {
      return { ok: false, message: `“${key}” isn’t a recognised setting.` };
    }
  }

  const patch: Partial<Preferences> = {};

  if ("theme" in body) {
    if (
      typeof body.theme !== "string" ||
      !(THEMES as readonly string[]).includes(body.theme)
    ) {
      return { ok: false, message: "Choose a valid theme." };
    }
    patch.theme = body.theme as Preferences["theme"];
  }

  if ("typingSpeed" in body) {
    if (
      typeof body.typingSpeed !== "string" ||
      !(TYPING_SPEEDS as readonly string[]).includes(body.typingSpeed)
    ) {
      return { ok: false, message: "Choose a valid typing speed." };
    }
    patch.typingSpeed = body.typingSpeed as Preferences["typingSpeed"];
  }

  for (const key of [
    "sendWithEnter",
    "showSuggestions",
    "instructionsEnabled",
  ] as const) {
    if (key in body) {
      if (typeof body[key] !== "boolean") {
        return { ok: false, message: `“${key}” must be true or false.` };
      }
      patch[key] = body[key] as boolean;
    }
  }

  if ("defaultModel" in body) {
    const value = body.defaultModel;
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > MAX_MODEL_ID_LENGTH ||
      !MODEL_ID_PATTERN.test(value)
    ) {
      return { ok: false, message: "Choose a valid model." };
    }
    patch.defaultModel = value;
  }

  for (const key of ["instructionsAbout", "instructionsStyle"] as const) {
    if (key in body) {
      const value = body[key];
      if (typeof value !== "string" || value.length > MAX_INSTRUCTIONS_LENGTH) {
        return {
          ok: false,
          message: `Custom instructions can be at most ${MAX_INSTRUCTIONS_LENGTH} characters.`,
        };
      }
      patch[key] = value;
    }
  }

  return { ok: true, patch };
}

export function preferencesRef(uid: string) {
  return getFirebaseAdminFirestore()
    .collection("users")
    .doc(uid)
    .collection("settings")
    .doc("preferences");
}

export async function readPreferences(uid: string): Promise<Preferences> {
  const snapshot = await preferencesRef(uid).get();
  return sanitizePreferences(snapshot.exists ? snapshot.data() : undefined);
}

// Custom instructions are read on the chat hot path, so they are cached
// in server memory for 60 s per user (Firestore free tier: 50k reads a
// day — an uncached read per chat message would burn that quickly).
const instructionsCache = new Map<
  string,
  { value: string | null; expiresAt: number }
>();
const INSTRUCTIONS_CACHE_MS = 60_000;

export function invalidateInstructionsCache(uid: string): void {
  instructionsCache.delete(uid);
}

/**
 * Returns the system-message text for the user's custom instructions,
 * or null when they are disabled/empty or settings cannot be read
 * (chat must never fail because a preference lookup failed).
 */
export async function getCustomInstructionsSystemText(
  uid: string,
): Promise<string | null> {
  const cached = instructionsCache.get(uid);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: string | null = null;
  try {
    const preferences = await readPreferences(uid);
    if (preferences.instructionsEnabled) {
      const parts: string[] = [];
      if (preferences.instructionsAbout.trim()) {
        parts.push(
          `What the user wants you to know about them:\n${preferences.instructionsAbout.trim()}`,
        );
      }
      if (preferences.instructionsStyle.trim()) {
        parts.push(
          `How the user wants you to respond:\n${preferences.instructionsStyle.trim()}`,
        );
      }
      value = parts.length > 0 ? parts.join("\n\n") : null;
    }
  } catch (error) {
    console.error("Couldn’t read custom instructions for chat.", error);
    value = null;
  }

  instructionsCache.set(uid, {
    value,
    expiresAt: Date.now() + INSTRUCTIONS_CACHE_MS,
  });
  return value;
}

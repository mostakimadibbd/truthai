"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import type { User } from "firebase/auth";
import {
  DEFAULT_PREFERENCES,
  sanitizePreferences,
  type Preferences,
} from "@/lib/preferences";
import { applyThemePreference } from "@/lib/theme-client";
import { tryGetFirebaseFirestore } from "@/lib/firebase/firestore-client";

// Client access to settings. Reads come from a Firestore snapshot of
// users/{uid}/settings/preferences (rules: owner read, no client
// write), so every signed-in surface — settings, chat composer,
// streaming speed — reacts live when a preference changes anywhere.
// Writes always go through /api/settings (server-validated).

export function usePreferences(user: User | null): {
  preferences: Preferences;
  loaded: boolean;
} {
  const [preferences, setPreferences] =
    useState<Preferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) {
      setPreferences(DEFAULT_PREFERENCES);
      setLoaded(false);
      return;
    }
    const db = tryGetFirebaseFirestore();
    if (!db) {
      setLoaded(true);
      return;
    }
    return onSnapshot(
      doc(db, "users", user.uid, "settings", "preferences"),
      (snapshot) => {
        const next = sanitizePreferences(snapshot.data());
        setPreferences(next);
        // Keep the live document and the pre-paint localStorage
        // mirror in step with the saved theme (Phase 6).
        applyThemePreference(next.theme);
        setLoaded(true);
      },
      () => setLoaded(true),
    );
  }, [user]);

  return { preferences, loaded };
}

export async function getApiErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const result: unknown = await response.json().catch(() => null);
  if (
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    typeof result.error === "object" &&
    result.error !== null &&
    "message" in result.error &&
    typeof result.error.message === "string"
  ) {
    return result.error.message;
  }
  return fallback;
}

/** Authenticated JSON call to a Phase 3 API (session cookie + ID token). */
export async function settingsApi(
  user: User,
  path: string,
  init: { method: string; body?: Record<string, unknown> },
): Promise<Response> {
  const idToken = await user.getIdToken();
  return fetch(path, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
      "X-Requested-With": "xyro",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
}

export async function fetchPreferences(user: User): Promise<Preferences> {
  const response = await settingsApi(user, "/api/settings", { method: "GET" });
  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(response, "Settings couldn’t be loaded."),
    );
  }
  const data = (await response.json()) as { preferences?: unknown };
  return sanitizePreferences(data.preferences);
}

export async function patchPreferences(
  user: User,
  patch: Partial<Preferences>,
): Promise<Preferences> {
  const response = await settingsApi(user, "/api/settings", {
    method: "PATCH",
    body: patch as Record<string, unknown>,
  });
  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(response, "Your change couldn’t be saved."),
    );
  }
  const data = (await response.json()) as { preferences?: unknown };
  return sanitizePreferences(data.preferences);
}

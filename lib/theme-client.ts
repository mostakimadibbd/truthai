"use client";

import type { Theme } from "@/lib/preferences";

// Theme application on the client.
//
// The saved preference (system / dark / light) lives in Firestore via
// /api/settings, but first paint cannot wait for that round-trip, so
// the preference is mirrored in localStorage under this key. The
// inline script in the root layout reads the mirror before first
// paint, resolves "system" against prefers-color-scheme, and sets
// data-theme="dark" | "light" on <html>; globals.css keys every
// colour off that attribute. This module keeps the mirror and the
// live document in sync whenever preferences load or change.

export const THEME_STORAGE_KEY = "xyro-theme";

export function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme === "dark" || theme === "light") return theme;
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

export function applyThemePreference(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolveTheme(theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); the
    // attribute above still applies the theme for this page view.
  }
}

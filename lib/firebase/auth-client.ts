"use client";

import {
  browserLocalPersistence,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth,
} from "firebase/auth";
import { getFirebaseApp, isFirebaseConfigured } from "./app-client";

export { isFirebaseConfigured };

let auth: Auth | undefined;

export function getFirebaseAuth(): Auth {
  if (auth) return auth;

  const app = getFirebaseApp();
  try {
    // No popupRedirectResolver here on purpose: the default resolver loads
    // Google's script globally, which is part of the Trusted Types problem
    // and is only needed on the auth pages. Those call sites pass
    // browserPopupRedirectResolver per call to signInWithPopup /
    // signInWithRedirect instead. Persistence is always local
    // (IndexedDB first, then localStorage).
    auth = initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    });
  } catch (error) {
    // Auth was already initialized for this app (e.g. hot reload) — reuse it.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "auth/already-initialized"
    ) {
      auth = getAuth(app);
    } else {
      console.error("Firebase Auth initialization failed.", error);
      throw error;
    }
  }

  return auth;
}

// Non-throwing variant for use during render and in effects: returns
// null (the "unavailable" state) and logs instead of throwing, so a
// Firebase initialization failure can never crash a component.
export function tryGetFirebaseAuth(): Auth | null {
  try {
    return getFirebaseAuth();
  } catch (error) {
    console.error("Firebase Auth is unavailable.", error);
    return null;
  }
}

"use client";

import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth,
} from "firebase/auth";
import { getDatabase, type Database } from "firebase/database";
import { getFirestore, type Firestore } from "firebase/firestore";

const publicConfigValues = [
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
];

export const isFirebaseConfigured = publicConfigValues.every(
  (value) => typeof value === "string" && value.trim().length > 0,
);

export const isFirebaseRealtimeDatabaseConfigured =
  isFirebaseConfigured &&
  typeof process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL === "string" &&
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL.trim().length > 0;

function requiredValue(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(`Missing Firebase configuration: ${name}`);
  }
  return value.trim();
}

function readFirebaseConfig(): FirebaseOptions {
  return {
    apiKey: requiredValue(
      "NEXT_PUBLIC_FIREBASE_API_KEY",
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    ),
    authDomain: requiredValue(
      "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    ),
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim() || undefined,
    projectId: requiredValue(
      "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    ),
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim(),
    appId: requiredValue(
      "NEXT_PUBLIC_FIREBASE_APP_ID",
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    ),
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID?.trim(),
  };
}

let auth: Auth | undefined;
let db: Firestore | undefined;
let realtimeDb: Database | undefined;

function getFirebaseApp() {
  if (!isFirebaseConfigured) {
    throw new Error(
      "Firebase is not configured. Add the NEXT_PUBLIC_FIREBASE_* values from your Firebase web app.",
    );
  }

  try {
    return getApps().length > 0 ? getApp() : initializeApp(readFirebaseConfig());
  } catch (error) {
    console.error("Firebase app initialization failed.", error);
    throw error;
  }
}

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

export function getFirebaseFirestore(): Firestore {
  if (!db) {
    try {
      db = getFirestore(getFirebaseApp());
    } catch (error) {
      console.error("Firebase Firestore initialization failed.", error);
      throw error;
    }
  }

  return db;
}

export function getFirebaseRealtimeDatabase(): Database {
  if (!isFirebaseRealtimeDatabaseConfigured) {
    throw new Error(
      "Realtime Database is not configured. Set NEXT_PUBLIC_FIREBASE_DATABASE_URL to the database URL from Firebase Console.",
    );
  }

  if (!realtimeDb) {
    try {
      realtimeDb = getDatabase(
        getFirebaseApp(),
        requiredValue(
          "NEXT_PUBLIC_FIREBASE_DATABASE_URL",
          process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
        ),
      );
    } catch (error) {
      console.error("Firebase Realtime Database initialization failed.", error);
      throw error;
    }
  }

  return realtimeDb;
}

export function getFirebaseServices(): { auth: Auth; db: Firestore } {
  return { auth: getFirebaseAuth(), db: getFirebaseFirestore() };
}

// Non-throwing variants for use during render and in effects: they return
// null (the "unavailable" state) and log instead of throwing, so a Firebase
// initialization failure can never crash a component. Callers check for
// null and show their existing not-configured / error state.
export function tryGetFirebaseAuth(): Auth | null {
  try {
    return getFirebaseAuth();
  } catch (error) {
    console.error("Firebase Auth is unavailable.", error);
    return null;
  }
}

export function tryGetFirebaseFirestore(): Firestore | null {
  try {
    return getFirebaseFirestore();
  } catch (error) {
    console.error("Firebase Firestore is unavailable.", error);
    return null;
  }
}

export function tryGetFirebaseRealtimeDatabase(): Database | null {
  try {
    return getFirebaseRealtimeDatabase();
  } catch (error) {
    console.error("Firebase Realtime Database is unavailable.", error);
    return null;
  }
}

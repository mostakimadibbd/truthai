"use client";

import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";

// Split out of the old all-in-one client.ts (bundle audit fix,
// 2026-11-16): that module imported the Auth, Firestore and
// Realtime Database SDKs together, so EVERY page that needed just
// one service (sign-in needs only Auth) downloaded all three.
// Each service now has its own module on top of this shared app
// bootstrap; import the specific *-client module you need.

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

export function requiredValue(name: string, value: string | undefined): string {
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

export function getFirebaseApp(): FirebaseApp {
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

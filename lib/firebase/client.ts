"use client";

import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
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
    projectId: requiredValue(
      "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    ),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim(),
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim(),
    appId: requiredValue(
      "NEXT_PUBLIC_FIREBASE_APP_ID",
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    ),
  };
}

let services: { auth: Auth; db: Firestore } | undefined;

export function getFirebaseServices(): { auth: Auth; db: Firestore } {
  if (!isFirebaseConfigured) {
    throw new Error(
      "Firebase is not configured. Add the NEXT_PUBLIC_FIREBASE_* values from your Firebase web app.",
    );
  }

  if (!services) {
    const app = getApps().length > 0
      ? getApp()
      : initializeApp(readFirebaseConfig());
    services = { auth: getAuth(app), db: getFirestore(app) };
  }

  return services;
}

"use client";

import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
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
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim(),
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

  return getApps().length > 0 ? getApp() : initializeApp(readFirebaseConfig());
}

export function getFirebaseAuth(): Auth {
  if (!auth) auth = getAuth(getFirebaseApp());

  return auth;
}

export function getFirebaseFirestore(): Firestore {
  if (!db) db = getFirestore(getFirebaseApp());

  return db;
}

export function getFirebaseRealtimeDatabase(): Database {
  if (!isFirebaseRealtimeDatabaseConfigured) {
    throw new Error(
      "Realtime Database is not configured. Set NEXT_PUBLIC_FIREBASE_DATABASE_URL to the database URL from Firebase Console.",
    );
  }

  if (!realtimeDb) {
    realtimeDb = getDatabase(
      getFirebaseApp(),
      requiredValue(
        "NEXT_PUBLIC_FIREBASE_DATABASE_URL",
        process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
      ),
    );
  }

  return realtimeDb;
}

export function getFirebaseServices(): { auth: Auth; db: Firestore } {
  return { auth: getFirebaseAuth(), db: getFirebaseFirestore() };
}

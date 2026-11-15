"use client";

import { getDatabase, type Database } from "firebase/database";
import {
  getFirebaseApp,
  isFirebaseRealtimeDatabaseConfigured,
  requiredValue,
} from "./app-client";

export { isFirebaseRealtimeDatabaseConfigured };

let realtimeDb: Database | undefined;

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

// Non-throwing variant for use during render and in effects.
export function tryGetFirebaseRealtimeDatabase(): Database | null {
  try {
    return getFirebaseRealtimeDatabase();
  } catch (error) {
    console.error("Firebase Realtime Database is unavailable.", error);
    return null;
  }
}

"use client";

import { getFirestore, type Firestore } from "firebase/firestore";
import { getFirebaseApp, isFirebaseConfigured } from "./app-client";

export { isFirebaseConfigured };

let db: Firestore | undefined;

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

// Non-throwing variant for use during render and in effects.
export function tryGetFirebaseFirestore(): Firestore | null {
  try {
    return getFirebaseFirestore();
  } catch (error) {
    console.error("Firebase Firestore is unavailable.", error);
    return null;
  }
}

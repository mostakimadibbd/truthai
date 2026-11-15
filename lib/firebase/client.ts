"use client";

// Compatibility barrel. Prefer importing the specific module —
// app-client, auth-client, firestore-client, database-client — so
// pages only download the Firebase services they actually use
// (bundle audit fix, 2026-11-16). This barrel re-exports all of
// them for the call sites that genuinely need several services.

export {
  getFirebaseApp,
  isFirebaseConfigured,
  isFirebaseRealtimeDatabaseConfigured,
} from "./app-client";
export { getFirebaseAuth, tryGetFirebaseAuth } from "./auth-client";
export { getFirebaseFirestore, tryGetFirebaseFirestore } from "./firestore-client";
export {
  getFirebaseRealtimeDatabase,
  tryGetFirebaseRealtimeDatabase,
} from "./database-client";

import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { getFirebaseAuth } from "./auth-client";
import { getFirebaseFirestore } from "./firestore-client";

export function getFirebaseServices(): { auth: Auth; db: Firestore } {
  return { auth: getFirebaseAuth(), db: getFirebaseFirestore() };
}

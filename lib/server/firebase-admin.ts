import { createPrivateKey } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import { normalizeAdminPrivateKey } from "./private-key";

export function getFirebaseAdminApp() {
  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const privateKey = normalizeAdminPrivateKey(
    process.env.FIREBASE_ADMIN_PRIVATE_KEY,
  );
  const clientProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim();

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase Admin credentials are not configured.");
  }
  try {
    createPrivateKey(privateKey);
  } catch {
    // Deliberately no key material in this message: it reaches server
    // logs and error responses. The fix is always the same - re-copy
    // the private_key field from the service-account JSON.
    throw new Error(
      "FIREBASE_ADMIN_PRIVATE_KEY could not be parsed as a PEM private key " +
        "after normalisation. Re-copy the private_key field from the " +
        "service-account JSON file into the environment variable.",
    );
  }
  if (clientProjectId && clientProjectId !== projectId) {
    throw new Error("Firebase Admin and Firebase web project IDs do not match.");
  }

  const appName = "xyro-auth";
  return getApps().find((candidate) => candidate.name === appName) ??
    initializeApp(
      {
        credential: cert({ projectId, clientEmail, privateKey }),
        projectId,
        databaseURL,
      },
      appName,
    );
}

export function getFirebaseAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}

export function getFirebaseAdminFirestore() {
  return getFirestore(getFirebaseAdminApp());
}

export function getFirebaseAdminDatabase() {
  const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim();
  if (!databaseURL) {
    throw new Error("Realtime Database is not configured.");
  }
  return getDatabase(getFirebaseAdminApp());
}

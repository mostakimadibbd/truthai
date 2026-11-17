import { createPrivateKey } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import { normalizeAdminPrivateKey } from "./private-key";
import { serverEnv } from "./env";

export function getFirebaseAdminApp() {
  const projectId = serverEnv.firebaseAdminProjectId;
  const clientEmail = serverEnv.firebaseAdminClientEmail;
  const privateKey = normalizeAdminPrivateKey(
    serverEnv.firebaseAdminPrivateKey,
  );
  const clientProjectId = serverEnv.firebaseWebProjectId;
  const databaseURL = serverEnv.firebaseDatabaseUrl;

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
  const databaseURL = serverEnv.firebaseDatabaseUrl;
  if (!databaseURL) {
    throw new Error("Realtime Database is not configured.");
  }
  return getDatabase(getFirebaseAdminApp());
}

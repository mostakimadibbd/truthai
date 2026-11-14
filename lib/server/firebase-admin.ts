import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";

export function getFirebaseAdminApp() {
  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  const clientProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim();

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase Admin credentials are not configured.");
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

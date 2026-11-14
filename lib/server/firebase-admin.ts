import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export function getFirebaseAdminAuth() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  const clientProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase Admin credentials are not configured.");
  }
  if (clientProjectId && clientProjectId !== projectId) {
    throw new Error("Firebase Admin and Firebase web project IDs do not match.");
  }

  const appName = "xyro-auth";
  const app =
    getApps().find((candidate) => candidate.name === appName) ??
    initializeApp(
      {
        credential: cert({ projectId, clientEmail, privateKey }),
        projectId,
      },
      appName,
    );

  return getAuth(app);
}

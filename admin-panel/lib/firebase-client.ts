"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

/**
 * The panel uses the SAME Firebase project as the product, so an
 * administrator signs in with their normal Xyro account. Being
 * signed in is not enough: the backend re-checks the account's
 * database admin flag on every data call.
 */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.projectId);

let app: FirebaseApp | null = null;

export function panelAuth(): Auth | null {
  if (!firebaseConfigured) return null;
  if (!app) {
    app = getApps().length ? getApp() : initializeApp(config);
  }
  return getAuth(app);
}

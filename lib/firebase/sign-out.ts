"use client";

import { signOut } from "firebase/auth";
import { clearIndexedDbPersistence, terminate } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseFirestore } from "./client";

// Shared sign-out teardown used by the header menu, the chat sidebar
// and the settings/account panel, always behind the confirmation
// dialog (components/sign-out-dialog.tsx).
//
// Order (per the Phase 2 brief):
//  1. POST /api/auth/logout (or /api/auth/logout-all) so the server
//     revokes the session in Redis and clears the cookie.
//  2. Wipe in-memory app data (the legacy chat-history key and the
//     Google redirect flag; live app state unmounts on navigation).
//  3. Firebase signOut.
//  4. Terminate Firestore and clear its IndexedDB persistence
//     (best effort — failures are logged, never blocking).
//  5. Navigate to "/" with a full page load. A full load matters:
//     a terminated Firestore instance cannot be reused, so the next
//     sign-in needs fresh module state.
//
// Every step is best-effort: a network error during the server call
// must never trap the user in a half-signed-in UI. The local teardown
// still ends the session on this device; the server session then ends
// by cookie expiry or revocation from another device.

async function postLogout(allDevices: boolean): Promise<void> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Requested-With": "xyro",
    };
    let body: Record<string, unknown> = {};
    if (allDevices) {
      // logout-all additionally requires the Firebase ID token so the
      // server can match it against the session uid.
      try {
        const user = getFirebaseAuth().currentUser;
        if (user) body = { idToken: await user.getIdToken() };
      } catch {
        // No ID token available; the server will reject and we still
        // complete the local teardown.
      }
    }
    await fetch(allDevices ? "/api/auth/logout-all" : "/api/auth/logout", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    console.error("Server sign-out request failed; continuing locally.", error);
  }
}

function wipeInMemoryData(): void {
  try {
    sessionStorage.removeItem("xyro-google-redirect");
    sessionStorage.removeItem("xyro-authsync-logout-at");
  } catch {
    // Storage unavailable (private mode); nothing else to wipe — chat
    // state lives in component memory and unmounts on navigation.
  }
}

export async function performSignOut(
  options: { allDevices?: boolean } = {},
): Promise<void> {
  await postLogout(options.allDevices === true);
  wipeInMemoryData();

  try {
    await signOut(getFirebaseAuth());
  } catch (error) {
    console.error("Firebase sign-out failed; continuing teardown.", error);
  }

  try {
    const db = getFirebaseFirestore();
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (error) {
    console.error("Firestore teardown after sign-out failed.", error);
  }

  window.location.assign("/");
}

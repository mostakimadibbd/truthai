"use client";

import { useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase/auth-client";
import { isFirebaseRealtimeDatabaseConfigured } from "@/lib/firebase/app-client";
import { trackUserPresence } from "@/lib/firebase/presence";

export default function FirebasePresence() {
  useEffect(() => {
    if (!isFirebaseConfigured) return;
    if (!isFirebaseRealtimeDatabaseConfigured) {
      console.error(
        "Firebase Realtime Database presence is disabled. Set NEXT_PUBLIC_FIREBASE_DATABASE_URL.",
      );
      return;
    }

    let stopPresence: (() => void) | undefined;
    let unsubscribeAuth: (() => void) | undefined;

    try {
      unsubscribeAuth = onAuthStateChanged(
        getFirebaseAuth(),
        (user) => {
          stopPresence?.();
          stopPresence = undefined;
          if (!user) return;

          try {
            stopPresence = trackUserPresence(user.uid);
          } catch (error) {
            console.error("Firebase Realtime Database presence could not start.", error);
          }
        },
        (error) => {
          console.error("Firebase Authentication state listener failed.", error);
        },
      );
    } catch (error) {
      console.error("Firebase Authentication could not be initialized.", error);
    }

    return () => {
      unsubscribeAuth?.();
      stopPresence?.();
    };
  }, []);

  return null;
}

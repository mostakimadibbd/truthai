"use client";

import {
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  set,
  type DatabaseReference,
} from "firebase/database";
import { getFirebaseRealtimeDatabase } from "./client";

export function trackUserPresence(uid: string): () => void {
  const database = getFirebaseRealtimeDatabase();
  const connectedRef = ref(database, ".info/connected");
  let active = true;
  let connectionRef: DatabaseReference | undefined;

  const unsubscribe = onValue(
    connectedRef,
    (snapshot) => {
      if (!active || snapshot.val() !== true) return;

      const newConnectionRef = push(ref(database, `presence/${uid}/connections`));
      connectionRef = newConnectionRef;

      void (async () => {
        try {
          await onDisconnect(newConnectionRef).remove();
          if (!active) return;

          await set(newConnectionRef, true);
          if (!active) await remove(newConnectionRef);
        } catch (error) {
          console.error("Could not update Firebase Realtime Database presence.", error);
        }
      })();
    },
    (error) => {
      console.error("Firebase Realtime Database connection monitoring failed.", error);
    },
  );

  return () => {
    active = false;
    unsubscribe();

    if (connectionRef) {
      void remove(connectionRef).catch((error: unknown) => {
        console.error("Could not remove the Realtime Database presence connection.", error);
      });
    }
  };
}

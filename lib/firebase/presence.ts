"use client";

import {
  goOffline,
  goOnline,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  set,
  type DatabaseReference,
} from "firebase/database";
import { getFirebaseRealtimeDatabase } from "./client";

type PresenceSession = {
  references: number;
  stop: () => void;
};

const presenceSessions = new Map<string, PresenceSession>();

function createPresenceSession(uid: string): PresenceSession {
  const database = getFirebaseRealtimeDatabase();
  const connectedRef = ref(database, ".info/connected");
  let active = true;
  let connectionRef: DatabaseReference | undefined;

  goOnline(database);
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

  return {
    references: 0,
    stop: () => {
      if (!active) return;
      active = false;
      unsubscribe();

      if (connectionRef) {
        void remove(connectionRef).catch((error: unknown) => {
          console.error("Could not remove the Realtime Database presence connection.", error);
        });
      }

      goOffline(database);
    },
  };
}

function stopSession(uid: string, session: PresenceSession): void {
  if (presenceSessions.get(uid) !== session) return;
  presenceSessions.delete(uid);
  session.stop();
}

export function trackUserPresence(uid: string): () => void {
  const existingSession = presenceSessions.get(uid);
  const session = existingSession ?? createPresenceSession(uid);
  if (!existingSession) presenceSessions.set(uid, session);
  session.references += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    session.references -= 1;
    if (session.references === 0) stopSession(uid, session);
  };
}

export function stopUserPresence(uid: string): void {
  const session = presenceSessions.get(uid);
  if (session) stopSession(uid, session);
}

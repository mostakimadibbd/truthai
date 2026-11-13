"use client";

import type { User } from "firebase/auth";
import {
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { getFirebaseServices } from "./client";

export async function saveUserProfile(user: User): Promise<void> {
  if (!user.email) {
    throw new Error("An email address is required to create an Xyro AI profile.");
  }

  const { db } = getFirebaseServices();
  const profileRef = doc(db, "users", user.uid);

  await runTransaction(db, async (transaction) => {
    const profileSnapshot = await transaction.get(profileRef);
    const profile = {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName ?? "",
      photoURL: user.photoURL ?? "",
      updatedAt: serverTimestamp(),
      lastSignInAt: serverTimestamp(),
    };

    if (profileSnapshot.exists()) {
      transaction.update(profileRef, profile);
    } else {
      transaction.set(profileRef, {
        ...profile,
        createdAt: serverTimestamp(),
      });
    }
  });
}

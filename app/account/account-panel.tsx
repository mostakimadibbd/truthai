"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import FirebasePresence from "@/components/firebase-presence";
import { stopUserPresence } from "@/lib/firebase/presence";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase/auth-client";
import { getFirebaseFirestore } from "@/lib/firebase/firestore-client";

type ProfileView = {
  email: string;
  displayName: string;
};

type AccountState =
  | "loading"
  | "not-configured"
  | "signed-out"
  | "profile"
  | "missing-profile"
  | "invalid-profile"
  | "error";

function getAccountErrorMessage(): string {
  return "We couldn’t load your account details. Check your connection and try again.";
}

export default function AccountPanel() {
  const router = useRouter();
  const [state, setState] = useState<AccountState>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setState("not-configured");
      return;
    }

    const auth = getFirebaseAuth();
    const db = getFirebaseFirestore();
    let stopProfile: (() => void) | undefined;

    const stopAuth = onAuthStateChanged(
      auth,
      (currentUser) => {
        stopProfile?.();
        stopProfile = undefined;

        if (!currentUser) {
          setUser(null);
          setProfile(null);
          setState("signed-out");
          router.replace("/sign-in");
          return;
        }

        setUser(currentUser);
        setProfile(null);
        setError("");
        setState("loading");

        stopProfile = onSnapshot(
          doc(db, "users", currentUser.uid),
          (snapshot) => {
            if (!snapshot.exists()) {
              setProfile(null);
              setState("missing-profile");
              return;
            }

            const data = snapshot.data();
            if (
              typeof data.email !== "string" ||
              typeof data.displayName !== "string"
            ) {
              setState("invalid-profile");
              setError("The saved profile has an unexpected format.");
              return;
            }

            setProfile({
              email: data.email,
              displayName: data.displayName,
            });
            setState("profile");
          },
          () => {
            setState("error");
            setError(getAccountErrorMessage());
          },
        );
      },
      () => {
        setState("error");
        setError(getAccountErrorMessage());
      },
    );

    return () => {
      stopAuth();
      stopProfile?.();
    };
  }, [router]);

  async function handleSignOut() {
    setSigningOut(true);
    setError("");
    try {
      if (user) stopUserPresence(user.uid);
      await signOut(getFirebaseAuth());
      router.replace("/sign-in");
    } catch {
      setError("We couldn’t sign you out. Check your connection and try again.");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="account-card">
      <FirebasePresence />
      {state === "loading" && <p role="status">Loading your saved profile…</p>}
      {state === "not-configured" && (
        <div className="auth-alert" role="alert">
          Firebase is not configured. Add the Firebase web settings locally or in Vercel, then redeploy.
        </div>
      )}
      {state === "signed-out" && <p role="status">Taking you to sign in…</p>}
      {state === "missing-profile" && (
        <div className="auth-alert" role="alert">
          You are signed in, but your profile document is missing. Sign out and sign in again after deploying the Firestore rules.
        </div>
      )}
      {state === "invalid-profile" && <div className="auth-alert" role="alert">{error}</div>}
      {state === "error" && <div className="auth-alert" role="alert">{error}</div>}
      {state === "profile" && profile && (
        <div className="profile-details">
          <span className="profile-monogram" aria-hidden="true">
            {(profile.displayName || profile.email).slice(0, 1).toUpperCase()}
          </span>
          <div>
            <span className="profile-label">Display name</span>
            <p>{profile.displayName || "Not set"}</p>
            <span className="profile-label">Email</span>
            <p>{profile.email}</p>
          </div>
          <p className="profile-note">
            The profile is read from <code>users/{user?.uid}</code>. Firestore rules allow only this signed-in account to read it.
          </p>
        </div>
      )}
      {error && state !== "error" && <div className="auth-alert" role="alert">{error}</div>}
      {user && (
        <button type="button" className="button button-outline auth-signout" onClick={handleSignOut} disabled={signingOut}>
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      )}
      <Link href="/" className="text-link account-home">Back to Xyro AI <span aria-hidden="true">→</span></Link>
    </div>
  );
}

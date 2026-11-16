"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { firebaseConfigured, panelAuth } from "@/lib/firebase-client";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const auth = panelAuth();
    if (!auth) return;
    const stop = onAuthStateChanged(auth, (current) => {
      if (current) router.replace("/");
    });
    return stop;
  }, [router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const auth = panelAuth();
    if (!auth) return;
    setBusy(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.replace("/");
    } catch {
      setError("Sign-in failed. Check the email and password.");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    const auth = panelAuth();
    if (!auth) return;
    setBusy(true);
    setError("");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      router.replace("/");
    } catch {
      setError("Google sign-in didn’t complete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="signin-wrap">
      <form className="signin-card" onSubmit={onSubmit}>
        <div className="brand-mark" aria-hidden="true">X</div>
        <h1>Xyro Control</h1>
        <p className="muted">
          Restricted console. Sign in with an administrator account —
          access is verified against the database on every request.
        </p>
        {!firebaseConfigured && (
          <div className="alert" role="alert">
            This panel isn’t configured yet (Firebase settings are missing).
          </div>
        )}
        {error && (
          <div className="alert" role="alert">{error}</div>
        )}
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy || !firebaseConfigured}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => void onGoogle()}
          disabled={busy || !firebaseConfigured}
        >
          Continue with Google
        </button>
      </form>
    </main>
  );
}

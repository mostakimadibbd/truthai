"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { getFirebaseServices, isFirebaseConfigured } from "@/lib/firebase/client";
import { saveUserProfile } from "@/lib/firebase/profile";

type AuthMode = "sign-in" | "sign-up";

function getErrorMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/email-already-in-use":
        return "An account already uses this email. Try signing in instead.";
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return "The email or password is not correct.";
      case "auth/weak-password":
        return "Choose a stronger password with at least 8 characters.";
      case "auth/operation-not-allowed":
        return "This sign-in method is disabled in Firebase Authentication settings.";
      case "auth/unauthorized-domain":
        return "This domain is not authorized in Firebase Authentication settings.";
      case "auth/popup-blocked":
        return "Your browser blocked the Google sign-in window. Allow pop-ups and try again.";
      case "auth/popup-closed-by-user":
        return "Google sign-in was closed before it finished.";
      case "permission-denied":
        return "Firebase Authentication succeeded, but Firestore rejected the profile write. Deploy firestore.rules and check the Firebase project settings.";
      case "unavailable":
        return "Firestore is temporarily unavailable. Check your connection and try again.";
      default:
        return `Firebase could not complete the request (${error.code}).`;
    }
  }

  if (error instanceof Error) return error.message;
  return "An unexpected error occurred. Please try again.";
}

export default function SignInForm() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingProfileUser, setPendingProfileUser] = useState<User | null>(null);
  const configured = isFirebaseConfigured;

  async function finishSignIn(user: User) {
    setPendingProfileUser(user);
    await saveUserProfile(user);
    setPendingProfileUser(null);
    router.replace("/account");
    router.refresh();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const { auth } = getFirebaseServices();
      if (mode === "sign-up") {
        const credential = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password,
        );
        await updateProfile(credential.user, { displayName: displayName.trim() });
        await credential.user.getIdToken(true);
        await finishSignIn(credential.user);
      } else {
        const credential = await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password,
        );
        await finishSignIn(credential.user);
      }
    } catch (authError) {
      setError(getErrorMessage(authError));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const { auth } = getFirebaseServices();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const credential = await signInWithPopup(auth, provider);
      await finishSignIn(credential.user);
    } catch (authError) {
      setError(getErrorMessage(authError));
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordReset() {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      if (!email.trim()) {
        setError("Enter your email address first, then request a reset link.");
        return;
      }
      const { auth } = getFirebaseServices();
      await sendPasswordResetEmail(auth, email.trim());
      setNotice("If an account exists for this address, Firebase will send a password reset email.");
    } catch (authError) {
      setError(getErrorMessage(authError));
    } finally {
      setBusy(false);
    }
  }

  async function retryProfileSave() {
    if (!pendingProfileUser) return;
    setBusy(true);
    setError("");

    try {
      await finishSignIn(pendingProfileUser);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    setError("");

    try {
      const { auth } = getFirebaseServices();
      await signOut(auth);
      setPendingProfileUser(null);
      setNotice("You have been signed out.");
    } catch (signOutError) {
      setError(getErrorMessage(signOutError));
    } finally {
      setBusy(false);
    }
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
    setNotice("");
  }

  return (
    <div className="auth-card">
      <div className="auth-tabs" aria-label="Account action">
        <button
          type="button"
          className={mode === "sign-in" ? "auth-tab active" : "auth-tab"}
          aria-pressed={mode === "sign-in"}
          onClick={() => changeMode("sign-in")}
          disabled={busy}
        >
          Sign in
        </button>
        <button
          type="button"
          className={mode === "sign-up" ? "auth-tab active" : "auth-tab"}
          aria-pressed={mode === "sign-up"}
          onClick={() => changeMode("sign-up")}
          disabled={busy}
        >
          Create account
        </button>
      </div>

      <h2>{mode === "sign-in" ? "Welcome back" : "Create your account"}</h2>
      <p className="auth-card-lede">
        {mode === "sign-in"
          ? "Sign in with Google or your email address."
          : "Use your email address or continue with Google."}
      </p>

      {!configured && (
        <div className="auth-alert" role="alert">
          Firebase is not configured, so sign-in is unavailable. Add the
          Firebase web settings from <code>.env.example</code> to
          <code> .env.local</code>, then restart the app.
        </div>
      )}
      {error && <div className="auth-alert" role="alert">{error}</div>}
      {notice && <div className="auth-notice" role="status">{notice}</div>}
      {pendingProfileUser && error && (
        <div className="auth-recovery-actions">
          <button
            type="button"
            className="button button-outline"
            onClick={retryProfileSave}
            disabled={busy}
          >
            Retry saving profile
          </button>
          <button
            type="button"
            className="auth-reset"
            onClick={handleSignOut}
            disabled={busy}
          >
            Sign out
          </button>
        </div>
      )}

      <button
        type="button"
        className="button auth-google"
        onClick={handleGoogleSignIn}
        disabled={!configured || busy}
      >
        <span className="google-mark" aria-hidden="true">G</span>
        {busy ? "Please wait…" : "Continue with Google"}
      </button>

      <div className="auth-divider"><span>or with email</span></div>

      <form className="auth-form" onSubmit={handleSubmit}>
        {mode === "sign-up" && (
          <label>
            Display name
            <input
              type="text"
              name="displayName"
              autoComplete="name"
              maxLength={100}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              disabled={!configured || busy}
            />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={!configured || busy}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            minLength={mode === "sign-up" ? 8 : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={!configured || busy}
          />
        </label>
        <button
          className="button button-primary auth-submit"
          type="submit"
          disabled={!configured || busy}
        >
          {busy
            ? "Please wait…"
            : mode === "sign-in"
              ? "Sign in with email"
              : "Create account"}
        </button>
      </form>

      {mode === "sign-in" && (
        <button
          type="button"
          className="auth-reset"
          onClick={handlePasswordReset}
          disabled={!configured || busy}
        >
          Forgot password?
        </button>
      )}

      <p className="auth-privacy">
        Your profile is private to your Firebase account. See the{" "}
        <a href="/privacy">Privacy Notice</a>.
      </p>
    </div>
  );
}

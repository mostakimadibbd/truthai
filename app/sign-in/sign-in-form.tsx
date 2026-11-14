"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase/auth-client";

const HIBP_URL = "https://api.pwnedpasswords.com/range/";

type AuthMode = "sign-in" | "sign-up";

function mapAuthError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/email-already-in-use":
        return "An account already exists for this email. Please use the sign-in form.";
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return "The email or password is not correct.";
      case "auth/weak-password":
        return "Choose a stronger password with at least 10 characters.";
      case "auth/operation-not-allowed":
        return "This sign-in method is currently disabled. Contact support to re-enable it.";
      case "auth/unauthorized-domain":
        return "This domain is not authorized for Firebase sign-in.";
      case "auth/popup-blocked":
      case "auth/popup-closed-by-user":
        return "Google sign-in was blocked or canceled. Please allow pop-ups and try again.";
      case "auth/redirect-cancelled-by-user":
        return "Google sign-in was canceled before it completed.";
      default:
        return "We could not complete that request. Please try again.";
    }
  }

  return "An unexpected error occurred. Please try again.";
}

async function isPwnedPassword(password: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-1", encoder.encode(password));
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const prefix = hashHex.slice(0, 5);
  const suffix = hashHex.slice(5);

  const response = await fetch(`${HIBP_URL}${prefix}`);
  if (!response.ok) {
    return false;
  }

  const body = await response.text();
  const lines = body.split(/\r?\n/);
  return lines.some((line) => {
    const [candidate] = line.split(":");
    return candidate === suffix;
  });
}

async function validatePassword(password: string): Promise<string | null> {
  if (password.length < 10) {
    return "Use a password with at least 10 characters.";
  }

  if (await isPwnedPassword(password)) {
    return "This password is commonly exposed in data breaches. Choose a different password.";
  }

  return null;
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

  useEffect(() => {
    if (!configured) return;

    const auth = getFirebaseAuth();
    void getRedirectResult(auth)
      .then((result) => {
        if (!result?.user) return;
        return finishSignIn(result.user);
      })
      .catch(() => {
        setError("Google sign-in could not be completed. Please try again.");
      });
  }, [configured]);

  async function finishSignIn(user: User) {
    if (!user.emailVerified) {
      const auth = getFirebaseAuth();
      await signOut(auth);
      setError("Verify your email before continuing to the workspace.");
      return;
    }

    setPendingProfileUser(user);
    const { saveUserProfile } = await import("@/lib/firebase/profile");
    await saveUserProfile(user);
    setPendingProfileUser(null);
    router.replace("/chat");
    router.refresh();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const auth = getFirebaseAuth();
      if (mode === "sign-up") {
        const passwordError = await validatePassword(password);
        if (passwordError) {
          setError(passwordError);
          return;
        }

        const credential = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password,
        );
        await updateProfile(credential.user, { displayName: displayName.trim() });
        await sendEmailVerification(credential.user);
        setNotice("Your account was created. Check your email and verify it before starting a chat.");
        await signOut(auth);
        setMode("sign-in");
        setPassword("");
        return;
      }

      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password,
      );
      await finishSignIn(credential.user);
    } catch (authError) {
      setError(mapAuthError(authError));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const auth = getFirebaseAuth();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        const credential = await signInWithPopup(auth, provider);
        await finishSignIn(credential.user);
      } catch (popupError) {
        const code = popupError instanceof FirebaseError ? popupError.code : undefined;
        const shouldRedirect =
          code === "auth/popup-blocked" ||
          code === "auth/popup-closed-by-user" ||
          code === "auth/operation-not-allowed" ||
          code === "auth/unauthorized-domain";

        if (shouldRedirect) {
          await signInWithRedirect(auth, provider);
          setNotice("Google sign-in is opening in a new browser tab. Return here after finishing sign-in.");
          return;
        }

        throw popupError;
      }
    } catch (authError) {
      setError(mapAuthError(authError));
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
        setError("Enter your email address before requesting a password reset.");
        return;
      }
      const auth = getFirebaseAuth();
      await sendPasswordResetEmail(auth, email.trim());
      setNotice("If an account exists for that email address, a reset link has been sent.");
    } catch (authError) {
      setError(mapAuthError(authError));
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
      setError(mapAuthError(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    setError("");

    try {
      const auth = getFirebaseAuth();
      await signOut(auth);
      setPendingProfileUser(null);
      setNotice("You have been signed out.");
    } catch (signOutError) {
      setError(mapAuthError(signOutError));
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
        <button type="button" className={mode === "sign-in" ? "auth-tab active" : "auth-tab"} aria-pressed={mode === "sign-in"} onClick={() => changeMode("sign-in")} disabled={busy}>Sign in</button>
        <button type="button" className={mode === "sign-up" ? "auth-tab active" : "auth-tab"} aria-pressed={mode === "sign-up"} onClick={() => changeMode("sign-up")} disabled={busy}>Create account</button>
      </div>

      <h2>{mode === "sign-in" ? "Welcome back" : "Create your account"}</h2>
      <p className="auth-card-lede">
        {mode === "sign-in" ? "Sign in with Google or your email address." : "Use your email address or continue with Google."}
      </p>

      {!configured && (
        <div className="auth-alert" role="alert">
          Firebase is not configured, so sign-in is unavailable. Add the Firebase web settings from <code>.env.example</code> to <code>.env.local</code>, then restart the app.
        </div>
      )}
      {error && <div className="auth-alert" role="alert">{error}</div>}
      {notice && <div className="auth-notice" role="status">{notice}</div>}
      {pendingProfileUser && error && (
        <div className="auth-recovery-actions">
          <button type="button" className="button button-outline" onClick={retryProfileSave} disabled={busy}>Retry saving profile</button>
          <button type="button" className="auth-reset" onClick={handleSignOut} disabled={busy}>Sign out</button>
        </div>
      )}

      <button type="button" className="button auth-google" onClick={handleGoogleSignIn} disabled={!configured || busy}>
        <span className="google-mark" aria-hidden="true">G</span>
        {busy ? "Please wait…" : "Continue with Google"}
      </button>

      <div className="auth-divider"><span>or with email</span></div>

      <form className="auth-form" onSubmit={handleSubmit}>
        {mode === "sign-up" && (
          <label>
            Display name
            <input type="text" name="displayName" autoComplete="name" maxLength={100} value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={busy} />
          </label>
        )}

        <label>
          Email
          <input type="email" name="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={!configured || busy} />
        </label>

        <label>
          Password
          <input type="password" name="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} required disabled={!configured || busy} />
        </label>

        <button className="button button-primary auth-submit" type="submit" disabled={!configured || busy}>
          {busy ? "Please wait…" : mode === "sign-in" ? "Sign in with email" : "Create account"}
        </button>
      </form>

      {mode === "sign-in" && (
        <button type="button" className="auth-reset" onClick={handlePasswordReset} disabled={!configured || busy}>Forgot password?</button>
      )}

      <p className="auth-privacy">
        Your profile is private to your Firebase account. See the <a href="/privacy">Privacy Notice</a>.
      </p>
    </div>
  );
}

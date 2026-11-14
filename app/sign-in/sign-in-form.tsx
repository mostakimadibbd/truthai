"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  reload,
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

type AuthMode = "sign-in" | "sign-up";

function getAuthErrorMessage(error: unknown): string {
  if (!(error instanceof FirebaseError)) {
    return error instanceof Error && error.message === "password-check-unavailable"
      ? "We couldn’t check this password right now. Please try again in a moment."
      : "Something went wrong. Please check your connection and try again.";
  }

  switch (error.code) {
    case "auth/email-already-in-use":
      return "An account already uses this email. Sign in instead, or reset your password.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email and password don’t match. Check them and try again.";
    case "auth/weak-password":
      return "Choose a password with at least 10 characters.";
    case "auth/operation-not-allowed":
      return "Email and password sign-in is turned off for this project. Contact the site administrator.";
    case "auth/unauthorized-domain":
      return "This site isn’t enabled for sign-in yet. Contact the site administrator.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in window. Try again or allow pop-ups for this site.";
    case "auth/popup-closed-by-user":
      return "The Google sign-in window was closed before you finished.";
    case "auth/too-many-requests":
      return "There have been too many attempts. Wait a little while, then try again.";
    case "auth/network-request-failed":
      return "We couldn’t reach the sign-in service. Check your connection and try again.";
    case "auth/account-exists-with-different-credential":
      return "An account already exists with this email. Sign in using its original method.";
    default:
      return "We couldn’t complete sign-in. Please try again.";
  }
}

function shouldUseRedirect(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|; wv\)|FBAN|FBAV|Instagram|Line\//i.test(
    navigator.userAgent,
  );
}

async function checkPasswordNotBreached(password: string): Promise<boolean> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(password),
  );
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const response = await fetch("/api/password/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: hash.slice(0, 5), suffix: hash.slice(5) }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("password-check-unavailable");
  }

  const result: unknown = await response.json();
  if (
    typeof result !== "object" ||
    result === null ||
    !("pwned" in result) ||
    typeof result.pwned !== "boolean"
  ) {
    throw new Error("password-check-unavailable");
  }
  return result.pwned;
}

export default function SignInForm({
  initialMode = "sign-in",
}: {
  initialMode?: AuthMode;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verificationUser, setVerificationUser] = useState<User | null>(null);
  const configured = isFirebaseConfigured;

  const completeSignIn = useCallback(async (user: User) => {
    await reload(user);
    if (!user.emailVerified) {
      setVerificationUser(user);
      setNotice("");
      setError("");
      return;
    }

    const { saveUserProfile } = await import("@/lib/firebase/profile");
    await saveUserProfile(user);
    router.replace("/chat");
    router.refresh();
  }, [router]);

  useEffect(() => {
    if (!configured) return;

    let active = true;
    const auth = getFirebaseAuth();
    void getRedirectResult(auth)
      .then(async (result) => {
        if (result?.user && active) {
          await completeSignIn(result.user);
        }
      })
      .catch((redirectError: unknown) => {
        if (active) setError(getAuthErrorMessage(redirectError));
      });

    return () => {
      active = false;
    };
  }, [completeSignIn, configured]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    setVerificationUser(null);

    try {
      const auth = getFirebaseAuth();
      if (mode === "sign-up") {
        if (password.length < 10) {
          setError("Use a password with at least 10 characters.");
          return;
        }

        if (await checkPasswordNotBreached(password)) {
          setError("This password appears in known data breaches. Please choose another one.");
          return;
        }

        const credential = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password,
        );
        if (displayName.trim()) {
          await updateProfile(credential.user, {
            displayName: displayName.trim().slice(0, 100),
          });
        }
        await sendEmailVerification(credential.user);
        setVerificationUser(credential.user);
        setNotice("Your account is ready. Verify your email to unlock your workspace.");
        setPassword("");
        return;
      }

      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password,
      );
      await completeSignIn(credential.user);
    } catch (authError) {
      setError(getAuthErrorMessage(authError));
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
      if (shouldUseRedirect()) {
        await signInWithRedirect(auth, provider);
        return;
      }

      try {
        const credential = await signInWithPopup(auth, provider);
        await completeSignIn(credential.user);
      } catch (popupError) {
        if (
          popupError instanceof FirebaseError &&
          popupError.code === "auth/popup-blocked"
        ) {
          await signInWithRedirect(auth, provider);
          return;
        }
        throw popupError;
      }
    } catch (authError) {
      setError(getAuthErrorMessage(authError));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerification() {
    if (!verificationUser) return;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      await reload(verificationUser);
      if (!verificationUser.emailVerified) {
        setError("Your email is not verified yet. Open the link in your inbox, then try again.");
        return;
      }
      await completeSignIn(verificationUser);
    } catch (verificationError) {
      setError(getAuthErrorMessage(verificationError));
    } finally {
      setBusy(false);
    }
  }

  async function handleResendVerification() {
    if (!verificationUser) return;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      await sendEmailVerification(verificationUser);
      setNotice("A fresh verification link is on its way. Check your inbox and spam folder.");
    } catch (verificationError) {
      setError(getAuthErrorMessage(verificationError));
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordReset() {
    if (!email.trim()) {
      setError("Enter your email address first, then choose “Forgot password?”.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
      setNotice("If an account exists for this address, a password reset email has been sent.");
    } catch (resetError) {
      setError(getAuthErrorMessage(resetError));
    } finally {
      setBusy(false);
    }
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
    setNotice("");
    setVerificationUser(null);
    setPassword("");
  }

  return (
    <div className="auth-layout">
      <section className="auth-story" aria-labelledby="auth-heading">
        <Link className="auth-back-link" href="/">
          <span aria-hidden="true">←</span> Back to Xyro AI
        </Link>
        <span className="auth-kicker"><span className="status-dot" /> A calmer space for curious minds</span>
        <h1 id="auth-heading">
          {mode === "sign-in" ? (
            <>Good to<br />have you <span>back.</span></>
          ) : (
            <>Make space<br />for <span>what&apos;s next.</span></>
          )}
        </h1>
        <p className="auth-story-copy">
          A thoughtful workspace for your questions, ideas, and the work you want to move forward.
        </p>
        <div className="auth-story-note">
          <span className="auth-note-icon" aria-hidden="true">✦</span>
          <p>AI can make mistakes. Your judgment is always part of the process.</p>
        </div>
        <div className="auth-orbit auth-orbit-one" aria-hidden="true" />
        <div className="auth-orbit auth-orbit-two" aria-hidden="true" />
      </section>

      <section className="auth-panel" aria-label={mode === "sign-in" ? "Sign in form" : "Create account form"}>
        <div className="auth-panel-heading">
          <div className="auth-mode-switch" aria-label="Account action">
            <button
              className={mode === "sign-in" ? "auth-mode active" : "auth-mode"}
              type="button"
              onClick={() => changeMode("sign-in")}
              aria-pressed={mode === "sign-in"}
              disabled={busy}
            >
              Sign in
            </button>
            <button
              className={mode === "sign-up" ? "auth-mode active" : "auth-mode"}
              type="button"
              onClick={() => changeMode("sign-up")}
              aria-pressed={mode === "sign-up"}
              disabled={busy}
            >
              Create account
            </button>
          </div>
          <h2>{mode === "sign-in" ? "Welcome back" : "Start with a free account"}</h2>
          <p>
            {mode === "sign-in"
              ? "Enter your details to continue to your workspace."
              : "A few details and you’re on your way."}
          </p>
        </div>

        {!configured && (
          <div className="form-message form-error" role="alert">
            Sign-in is not configured for this deployment. Add the Firebase web app settings and redeploy.
          </div>
        )}
        {error && <div className="form-message form-error" role="alert">{error}</div>}
        {notice && <div className="form-message form-success" role="status">{notice}</div>}

        {verificationUser ? (
          <div className="verification-card">
            <span className="verification-icon" aria-hidden="true">✉</span>
            <h3>Check your email</h3>
            <p>
              We sent a verification link to <strong>{verificationUser.email}</strong>. Verify it to continue.
            </p>
            <button
              className="button button-primary auth-submit"
              type="button"
              onClick={handleVerification}
              disabled={busy}
            >
              {busy ? "Checking…" : "I’ve verified my email"}
            </button>
            <button
              className="text-button"
              type="button"
              onClick={handleResendVerification}
              disabled={busy}
            >
              Send another verification email
            </button>
          </div>
        ) : (
          <>
            <button
              className="button button-google"
              type="button"
              onClick={handleGoogleSignIn}
              disabled={!configured || busy}
            >
              <span className="google-mark" aria-hidden="true">G</span>
              <span>Continue with Google</span>
            </button>

            <div className="auth-separator"><span>or continue with email</span></div>

            <form className="auth-form" onSubmit={handleSubmit} noValidate>
              {mode === "sign-up" && (
                <label className="form-field">
                  <span>Your name <span className="optional-label">Optional</span></span>
                  <input
                    type="text"
                    name="displayName"
                    autoComplete="name"
                    maxLength={100}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    disabled={!configured || busy}
                    placeholder="How should we address you?"
                  />
                </label>
              )}

              <label className="form-field">
                <span>Email address</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={!configured || busy}
                  placeholder="you@example.com"
                  required
                />
              </label>

              <label className="form-field">
                <span>Password</span>
                <input
                  type="password"
                  name="password"
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  minLength={mode === "sign-up" ? 10 : 1}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={!configured || busy}
                  placeholder={mode === "sign-up" ? "At least 10 characters" : "Enter your password"}
                  required
                />
              </label>

              {mode === "sign-up" && (
                <p className="password-help">
                  Use 10 or more characters. We’ll check that it hasn’t appeared in known breaches.
                </p>
              )}

              {mode === "sign-in" && (
                <button
                  className="forgot-password"
                  type="button"
                  onClick={handlePasswordReset}
                  disabled={!configured || busy}
                >
                  Forgot password?
                </button>
              )}

              <button
                className="button button-primary auth-submit"
                type="submit"
                disabled={!configured || busy}
              >
                {busy
                  ? "Please wait…"
                  : mode === "sign-in"
                    ? "Sign in"
                    : "Create your account"}
                {!busy && <span aria-hidden="true">→</span>}
              </button>
            </form>

            <p className="auth-legal">
              By continuing, you agree to our <Link href="/terms">Terms</Link> and{" "}
              <Link href="/privacy">Privacy Policy</Link>.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

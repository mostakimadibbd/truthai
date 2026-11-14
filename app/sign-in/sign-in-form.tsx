"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  getRedirectResult,
  GoogleAuthProvider,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  updateProfile,
  type User,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase/auth-client";
import TurnstileField, { notifyTurnstileReady } from "@/components/turnstile-field";

type AuthMode = "sign-in" | "sign-up";

function getAuthErrorMessage(error: unknown): string {
  if (!(error instanceof FirebaseError)) {
    return "Something went wrong. Please check your connection and try again.";
  }

  switch (error.code) {
    case "auth/email-already-in-use":
      return "An account already uses this email. Sign in instead, or reset your password.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email and password don’t match. Check them and try again.";
    case "auth/user-disabled":
      return "This account is disabled. Contact the site administrator for help.";
    case "auth/weak-password":
      return "Choose a password with at least 10 characters.";
    case "auth/operation-not-allowed":
      return "Email and password sign-in is turned off for this project. Contact the site administrator.";
    case "auth/unauthorized-domain":
      return "This site isn’t enabled for sign-in yet. Contact the site administrator.";
    case "auth/invalid-api-key":
    case "auth/app-not-authorized":
      return "Firebase is misconfigured for this site. Check the Firebase web app settings and authorized domains.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in window. Try again or allow pop-ups for this site.";
    case "auth/popup-closed-by-user":
      return "The Google sign-in window was closed before you finished.";
    case "auth/too-many-requests":
      return "There have been too many attempts. Wait a little while, then try again.";
    case "auth/missing-email":
      return "Enter your email address.";
    case "auth/missing-password":
      return "Enter your password.";
    case "auth/network-request-failed":
      return "We couldn’t reach the sign-in service. Check your connection and try again.";
    case "auth/account-exists-with-different-credential":
      return "An account already exists with this email. Sign in using its original method.";
    default:
      return "We couldn’t complete sign-in. Please try again.";
  }
}

async function getApiErrorMessage(response: Response, fallback: string): Promise<string> {
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    return fallback;
  }
  if (
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    typeof result.error === "object" &&
    result.error !== null &&
    "message" in result.error &&
    typeof result.error.message === "string"
  ) {
    return result.error.message;
  }
  return fallback;
}

function getProfileSaveErrorMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    if (error.code === "permission-denied") {
      return "Your account exists, but Firestore rejected the profile save. Confirm that Cloud Firestore is created and the current firestore.rules are deployed.";
    }
    if (error.code === "unavailable" || error.code === "deadline-exceeded") {
      return "Your account exists, but Firestore is temporarily unreachable. Check your connection and retry the profile save.";
    }
  }
  return "Your account exists, but we couldn’t save its profile in Firestore. Check the Firebase configuration and retry.";
}

function shouldUseRedirect(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|; wv\)|FBAN|FBAV|Instagram|Line\//i.test(
    navigator.userAgent,
  );
}

export default function SignInForm({
  initialMode = "sign-in",
}: {
  initialMode?: AuthMode;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileStatus, setTurnstileStatus] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verificationUser, setVerificationUser] = useState<User | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const configured = isFirebaseConfigured;
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
  const mode = initialMode;

  const completeSignIn = useCallback(async (user: User) => {
    await reload(user);
    setVerificationUser(user);
    setEmailVerified(user.emailVerified);
    setProfileSaved(false);

    try {
      const { saveUserProfile } = await import("@/lib/firebase/profile");
      await saveUserProfile(user);
      setProfileSaved(true);
    } catch (profileError) {
      setError(getProfileSaveErrorMessage(profileError));
      return;
    }

    if (!user.emailVerified) {
      setNotice("");
      setError("");
      return;
    }

    setVerificationUser(null);
    router.replace("/chat");
    router.refresh();
  }, [router]);

  function resetTurnstile() {
    setTurnstileToken("");
    setTurnstileStatus("");
    setTurnstileResetKey((key) => key + 1);
  }

  useEffect(() => {
    if (!configured) return;

    let active = true;
    let redirectResult: ReturnType<typeof getRedirectResult>;
    try {
      redirectResult = getRedirectResult(getFirebaseAuth());
    } catch (redirectError) {
      setError(getAuthErrorMessage(redirectError));
      return;
    }

    void redirectResult
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
    if (mode === "sign-up") {
      if (!termsAccepted) {
        setError("Please agree to the Terms and Conditions and Privacy Policy to create an account.");
        return;
      }
      if (!turnstileSiteKey) {
        setError("Account security verification isn’t configured. Please contact the site administrator.");
        return;
      }
      if (!turnstileToken) {
        setError("Complete the security check before creating your account.");
        return;
      }
    }

    setBusy(true);
    setError("");
    setNotice("");
    setVerificationUser(null);
    setProfileSaved(false);
    setEmailVerified(false);

    try {
      const auth = getFirebaseAuth();
      await setPersistence(
        auth,
        rememberMe ? browserLocalPersistence : browserSessionPersistence,
      );
      if (mode === "sign-up") {
        if (password.length < 10) {
          setError("Use a password with at least 10 characters.");
          return;
        }

        const response = await fetch("/api/auth/sign-up", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            password,
            displayName: displayName.trim().slice(0, 100),
            turnstileToken,
          }),
          cache: "no-store",
        });
        if (!response.ok) {
          setError(await getApiErrorMessage(response, "We couldn’t create your account. Please try again."));
          return;
        }

        const result: unknown = await response.json();
        if (
          typeof result !== "object" ||
          result === null ||
          !("customToken" in result) ||
          typeof result.customToken !== "string"
        ) {
          setError("The account service returned an invalid response. Please try again.");
          return;
        }

        const credential = await signInWithCustomToken(auth, result.customToken);
        setVerificationUser(credential.user);
        setProfileSaved(false);
        setEmailVerified(false);
        setPassword("");
        if (displayName.trim()) {
          try {
            await updateProfile(credential.user, {
              displayName: displayName.trim().slice(0, 100),
            });
          } catch {
            setError("Your account was created, but we couldn’t save the display name. You can update your profile later.");
          }
        }

        let savedProfile = false;
        try {
          const { saveUserProfile } = await import("@/lib/firebase/profile");
          await saveUserProfile(credential.user);
          savedProfile = true;
          setProfileSaved(true);
        } catch (profileError) {
          setError(getProfileSaveErrorMessage(profileError));
        }

        try {
          await sendEmailVerification(credential.user);
        } catch {
          setError(savedProfile
            ? "Your profile is saved, but we couldn’t send the verification email. Use the resend option below."
            : "Your account exists, but we couldn’t save its profile or send the verification email. Retry both below.");
          return;
        }
        setNotice(savedProfile
          ? "Your account and profile are saved. Verify your email to open your workspace."
          : "We sent a verification email. Save your profile below before continuing.");
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
      if (mode === "sign-up") resetTurnstile();
      setBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    if (mode === "sign-up") {
      if (!termsAccepted) {
        setError("Please agree to the Terms and Conditions and Privacy Policy to create an account.");
        return;
      }
      if (!turnstileSiteKey) {
        setError("Account security verification isn’t configured. Please contact the site administrator.");
        return;
      }
      if (!turnstileToken) {
        setError("Complete the security check before creating an account.");
        return;
      }
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const auth = getFirebaseAuth();
      await setPersistence(
        auth,
        rememberMe ? browserLocalPersistence : browserSessionPersistence,
      );
      if (mode === "sign-up") {
        const response = await fetch("/api/auth/turnstile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: turnstileToken }),
          cache: "no-store",
        });
        if (!response.ok) {
          setError(await getApiErrorMessage(response, "The security check failed. Please try again."));
          return;
        }
      }

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
      if (mode === "sign-up") resetTurnstile();
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
      setEmailVerified(verificationUser.emailVerified);
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

  async function handleRetryProfileSave() {
    if (!verificationUser) return;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const { saveUserProfile } = await import("@/lib/firebase/profile");
      await saveUserProfile(verificationUser);
      setProfileSaved(true);
      if (emailVerified) {
        setVerificationUser(null);
        router.replace("/chat");
        router.refresh();
      } else {
        setNotice("Your profile is saved. Verify your email to open your workspace.");
      }
    } catch (profileError) {
      setError(getProfileSaveErrorMessage(profileError));
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
            <Link
              href="/sign-in"
              className={mode === "sign-in" ? "auth-mode active" : "auth-mode"}
              aria-current={mode === "sign-in" ? "page" : undefined}
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className={mode === "sign-up" ? "auth-mode active" : "auth-mode"}
              aria-current={mode === "sign-up" ? "page" : undefined}
            >
              Create account
            </Link>
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
            <h3>{profileSaved ? "Account details saved" : "Finish setting up your account"}</h3>
            <p>
              {profileSaved
                ? <>Your profile for <strong>{verificationUser.email}</strong> is saved. {emailVerified ? "You can continue to your workspace." : "Verify your email to use AI features."}</>
                : <>Your Firebase account for <strong>{verificationUser.email}</strong> exists, but its profile has not been saved yet.</>}
            </p>
            {!profileSaved && (
              <button
                className="button button-primary auth-submit"
                type="button"
                onClick={handleRetryProfileSave}
                disabled={busy}
              >
                {busy ? "Saving…" : "Retry saving my profile"}
              </button>
            )}
            {profileSaved && emailVerified && (
              <button
                className="button button-primary auth-submit"
                type="button"
                onClick={handleRetryProfileSave}
                disabled={busy}
              >
                {busy ? "Opening…" : "Continue to workspace"}
              </button>
            )}
            {profileSaved && !emailVerified && (
              <>
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
              </>
            )}
            {!profileSaved && !emailVerified && (
              <button
                className="text-button"
                type="button"
                onClick={handleResendVerification}
                disabled={busy}
              >
                Resend verification email
              </button>
            )}
            {profileSaved && !emailVerified && (
              <Link className="button button-outline auth-submit" href="/settings">
                Continue to account settings
              </Link>
            )}
          </div>
        ) : (
          <>
            {mode === "sign-up" && (
              <div className="auth-signup-security">
                <label className="auth-checkbox-row auth-consent-row">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(event) => {
                      setTermsAccepted(event.target.checked);
                      setError("");
                    }}
                    disabled={!configured || busy}
                  />
                  <span>
                    I agree to the <Link href="/terms">Terms and Conditions</Link> and have read the{" "}
                    <Link href="/privacy">Privacy Policy</Link>.
                  </span>
                </label>
                {turnstileSiteKey ? (
                  <>
                    <Script
                      src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                      strategy="afterInteractive"
                      onReady={notifyTurnstileReady}
                      onError={() => setTurnstileStatus("The security check couldn’t load. Please refresh and try again.")}
                    />
                    <TurnstileField
                      key={turnstileResetKey}
                      siteKey={turnstileSiteKey}
                      resetKey={turnstileResetKey}
                      onToken={setTurnstileToken}
                      onStatus={setTurnstileStatus}
                    />
                    {turnstileStatus && (
                      <p className="turnstile-status" role="status">{turnstileStatus}</p>
                    )}
                  </>
                ) : (
                  <p className="turnstile-status" role="alert">
                    Account creation security verification isn’t configured for this deployment.
                  </p>
                )}
              </div>
            )}

            <button
              className="button button-google"
              type="button"
              onClick={handleGoogleSignIn}
              disabled={
                !configured ||
                busy ||
                (mode === "sign-up" && (!termsAccepted || !turnstileSiteKey || !turnstileToken))
              }
            >
              <span className="google-mark" aria-hidden="true">G</span>
              <span>Continue with Google</span>
            </button>

            <div className="auth-separator"><span>or continue with email</span></div>

            <form className="auth-form" onSubmit={handleSubmit}>
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
                  maxLength={1024}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={!configured || busy}
                  placeholder={mode === "sign-up" ? "At least 10 characters" : "Enter your password"}
                  required
                />
              </label>

              {mode === "sign-up" && (
                <p className="password-help">
                  Use 10 or more characters. We’ll check it securely against known breaches before creating your account.
                </p>
              )}

              <label className="auth-checkbox-row auth-remember-row">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  disabled={!configured || busy}
                />
                <span>Remember me</span>
                <small>
                  {rememberMe ? "Stay signed in on this device" : "Sign out when you close the browser"}
                </small>
              </label>

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
                disabled={
                  !configured ||
                  busy ||
                  (mode === "sign-up" && (!termsAccepted || !turnstileSiteKey || !turnstileToken))
                }
              >
                {busy
                  ? "Please wait…"
                  : mode === "sign-in"
                    ? "Sign in"
                    : "Create your account"}
                {!busy && <span aria-hidden="true">→</span>}
              </button>
            </form>

            {mode === "sign-in" ? (
              <p className="auth-legal">
                By continuing, you agree to our <Link href="/terms">Terms</Link> and{" "}
                <Link href="/privacy">Privacy Policy</Link>.
              </p>
            ) : (
              <p className="auth-legal">
                Your account stays yours. You can review or update your profile after signing in.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

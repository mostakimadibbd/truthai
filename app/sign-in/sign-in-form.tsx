"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  browserPopupRedirectResolver,
  getRedirectResult,
  GoogleAuthProvider,
  reload,
  signInWithCustomToken,
  signInWithPopup,
  signInWithRedirect,
  updateProfile,
  type User,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase/auth-client";
import { nextPathOrDefault } from "@/lib/auth-redirect";
import TurnstileWidget from "@/components/turnstile-widget";
import TurnstileBoundary from "@/components/turnstile-boundary";

type AuthMode = "sign-in" | "sign-up";

const GOOGLE_REDIRECT_FLAG = "xyro-google-redirect";

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

function shouldUseRedirect(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|; wv\)|FBAN|FBAV|Instagram|Line\//i.test(
    navigator.userAgent,
  );
}

/** All /api/auth/* POSTs carry the header the server guard requires. */
function authFetch(path: string, body: Record<string, unknown>) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "xyro" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
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
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verificationUser, setVerificationUser] = useState<User | null>(null);
  const [signupStep, setSignupStep] = useState<"idle" | "creating" | "verify">("idle");
  const [showReset, setShowReset] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [googleReturnUser, setGoogleReturnUser] = useState<User | null>(null);
  const [googleTermsAccepted, setGoogleTermsAccepted] = useState(false);
  const [googleToken, setGoogleToken] = useState("");
  const [googleKey, setGoogleKey] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);
  const configured = isFirebaseConfigured;
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
  const mode = initialMode;
  const formAction = mode === "sign-up" ? "create_account" : "sign_in";

  // Finishes a sign-in whose server session already exists (the
  // /api/auth/sign-in custom-token flow, or /api/auth/session for
  // Google). There is deliberately NO client profile write and NO
  // intermediate card here: the profile is created/upserted
  // server-side, so during login the only progress UI is the submit
  // button's spinner. (The previous version set a verification user
  // before "saving the profile" client-side, which flashed the
  // "Finish setting up your account" card on every login.)
  //
  // If the server session call itself failed, callers never reach
  // this function — they stay on the form with an inline error and
  // can simply submit again.
  //
  // Unverified users are sent into the app as well: the chat
  // workspace shows the persistent "Verify your email" banner and
  // blocks sending until the email is verified.
  const completeSignIn = useCallback(async (user: User) => {
    await reload(user);
    setVerificationUser(null);
    const next = nextPathOrDefault(
      new URLSearchParams(window.location.search).get("next"),
    );
    router.replace(next);
    router.refresh();
  }, [router]);

  function resetTurnstile() {
    // Turnstile tokens are single-use: reset the widget after every
    // attempt so the next submit needs a fresh token.
    setTurnstileToken("");
    setTurnstileResetKey((key) => key + 1);
  }

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

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
        if (!result?.user || !active) return;
        // The Turnstile token does not survive a redirect, so a Google
        // redirect return must run the widget once more before the
        // server will issue a session.
        let flag: { termsAccepted?: boolean } | null = null;
        try {
          const raw = sessionStorage.getItem(GOOGLE_REDIRECT_FLAG);
          if (raw) flag = JSON.parse(raw) as { termsAccepted?: boolean };
          sessionStorage.removeItem(GOOGLE_REDIRECT_FLAG);
        } catch {
          flag = null;
        }
        // Whether or not the flag survived, a redirect return has no
        // Turnstile token and no server session yet, so it always
        // goes through the "one more step" widget before
        // /api/auth/session is called.
        setGoogleTermsAccepted(flag?.termsAccepted === true);
        setGoogleReturnUser(result.user);
        setNotice("One more step: verify you’re human to finish signing in.");
      })
      .catch((redirectError: unknown) => {
        if (active) setError(getAuthErrorMessage(redirectError));
      });

    return () => {
      active = false;
    };
  }, [configured]);

  /** Sends the verification email through the session-gated server route. */
  async function sendVerificationViaServer(user: User): Promise<boolean> {
    try {
      const idToken = await user.getIdToken();
      const response = await authFetch("/api/auth/resend-verification", { idToken });
      if (!response.ok) {
        setError(await getApiErrorMessage(response, "We couldn’t send the verification email. Please try again."));
        return false;
      }
      setResendCooldown(60);
      return true;
    } catch {
      setError("We couldn’t send the verification email. Check your connection and try again.");
      return false;
    }
  }

  async function establishGoogleSession(user: User, token: string, terms: boolean) {
    const idToken = await user.getIdToken();
    const response = await authFetch("/api/auth/session", {
      idToken,
      turnstileToken: token,
      action: formAction,
      ...(mode === "sign-up" ? { termsAccepted: terms } : {}),
    });
    if (!response.ok) {
      setError(await getApiErrorMessage(response, "The security check failed. Please try again."));
      return false;
    }
    return true;
  }

  async function handleGoogleReturnContinue() {
    if (!googleReturnUser || !googleToken) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const ok = await establishGoogleSession(googleReturnUser, googleToken, googleTermsAccepted);
      if (!ok) return;
      const user = googleReturnUser;
      setGoogleReturnUser(null);
      await completeSignIn(user);
    } catch (sessionError) {
      setError(getAuthErrorMessage(sessionError));
    } finally {
      setGoogleToken("");
      setGoogleKey((key) => key + 1);
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!turnstileSiteKey) {
      setError("Security verification isn’t configured. Please contact the site administrator.");
      return;
    }
    if (!turnstileToken) {
      setError("Complete the security check before continuing.");
      return;
    }
    if (mode === "sign-up" && !termsAccepted) {
      setError("Please agree to the Terms and Conditions and Privacy Policy to create an account.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    setVerificationUser(null);
    if (mode === "sign-up") setSignupStep("creating");

    try {
      const auth = getFirebaseAuth();
      if (mode === "sign-up") {
        if (password.length < 10) {
          setError("Use a password with at least 10 characters.");
          return;
        }

        const response = await authFetch("/api/auth/sign-up", {
          email: email.trim(),
          password,
          displayName: displayName.trim().slice(0, 100),
          turnstileToken,
          termsAccepted,
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

        // The server created the account AND its profile and minted
        // the session in one call, so steps 1–2 of the sign-up
        // progress are done; what remains is email verification.
        const credential = await signInWithCustomToken(auth, result.customToken);
        setVerificationUser(credential.user);
        setSignupStep("verify");
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

        const sent = await sendVerificationViaServer(credential.user);
        if (sent) {
          setNotice("Your account and profile are saved. Verify your email to open your workspace.");
        }
        return;
      }

      // Sign-in: the server verifies Turnstile and the password, then
      // returns a custom token and sets the session cookie.
      const response = await authFetch("/api/auth/sign-in", {
        email: email.trim(),
        password,
        turnstileToken,
      });
      if (!response.ok) {
        setError(await getApiErrorMessage(response, "We couldn’t sign you in. Please try again."));
        return;
      }
      const result: unknown = await response.json();
      if (
        typeof result !== "object" ||
        result === null ||
        !("customToken" in result) ||
        typeof result.customToken !== "string"
      ) {
        setError("The sign-in service returned an invalid response. Please try again.");
        return;
      }
      const credential = await signInWithCustomToken(auth, result.customToken);
      await completeSignIn(credential.user);
    } catch (authError) {
      setError(getAuthErrorMessage(authError));
    } finally {
      resetTurnstile();
      setBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    if (!turnstileSiteKey) {
      setError("Security verification isn’t configured. Please contact the site administrator.");
      return;
    }
    if (!turnstileToken) {
      setError("Complete the security check before continuing with Google.");
      return;
    }
    if (mode === "sign-up" && !termsAccepted) {
      setError("Please agree to the Terms and Conditions and Privacy Policy to create an account.");
      return;
    }

    setError("");
    setNotice("");

    const auth = getFirebaseAuth();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    if (shouldUseRedirect()) {
      // The Turnstile token is lost during the redirect; the return
      // step runs the widget again before calling /api/auth/session.
      try {
        sessionStorage.setItem(
          GOOGLE_REDIRECT_FLAG,
          JSON.stringify({ termsAccepted }),
        );
      } catch {
        // Storage unavailable: the return step will ask for terms again
        // via the generic flow.
      }
      setBusy(true);
      try {
        await signInWithRedirect(auth, provider, browserPopupRedirectResolver);
      } catch (redirectError) {
        setError(getAuthErrorMessage(redirectError));
        setBusy(false);
        resetTurnstile();
      }
      return;
    }

    // The popup must open synchronously on the click — no awaits before
    // this call, or browsers block it.
    let popupPromise: ReturnType<typeof signInWithPopup>;
    try {
      popupPromise = signInWithPopup(auth, provider, browserPopupRedirectResolver);
    } catch (popupError) {
      setError(getAuthErrorMessage(popupError));
      resetTurnstile();
      return;
    }

    setBusy(true);
    try {
      const credential = await popupPromise;
      const ok = await establishGoogleSession(credential.user, turnstileToken, termsAccepted);
      if (!ok) return;
      await completeSignIn(credential.user);
    } catch (popupError) {
      if (
        popupError instanceof FirebaseError &&
        popupError.code === "auth/popup-blocked"
      ) {
        try {
          sessionStorage.setItem(
            GOOGLE_REDIRECT_FLAG,
            JSON.stringify({ termsAccepted }),
          );
          await signInWithRedirect(auth, provider, browserPopupRedirectResolver);
          return;
        } catch (redirectError) {
          setError(getAuthErrorMessage(redirectError));
          return;
        }
      }
      setError(getAuthErrorMessage(popupError));
    } finally {
      resetTurnstile();
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
    if (!verificationUser || resendCooldown > 0) return;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const sent = await sendVerificationViaServer(verificationUser);
      if (sent) {
        setNotice("A fresh verification link is on its way. Check your inbox and spam folder.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }
    if (!resetToken) {
      setError("Complete the security check before requesting a reset.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await authFetch("/api/auth/reset", {
        email: email.trim(),
        turnstileToken: resetToken,
      });
      if (!response.ok) {
        setError(await getApiErrorMessage(response, "We couldn’t request a password reset. Please try again."));
        return;
      }
      const result: unknown = await response.json();
      const message =
        typeof result === "object" &&
        result !== null &&
        "message" in result &&
        typeof result.message === "string"
          ? result.message
          : "If an account exists for this address, a password reset email has been sent.";
      setNotice(message);
      setShowReset(false);
    } catch {
      setError("We couldn’t request a password reset. Check your connection and try again.");
    } finally {
      setResetToken("");
      setResetKey((key) => key + 1);
      setBusy(false);
    }
  }

  const formBlocked =
    !configured ||
    busy ||
    !turnstileSiteKey ||
    !turnstileToken ||
    (mode === "sign-up" && !termsAccepted);

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
        {mode === "sign-up" && signupStep !== "idle" && (
          <ol className="auth-steps" aria-label="Account creation progress">
            <li className={signupStep === "creating" ? "auth-step-active" : "auth-step-done"}>
              Creating account
            </li>
            <li className={signupStep === "verify" ? "auth-step-done" : ""}>
              Saving profile
            </li>
            <li className={signupStep === "verify" ? "auth-step-active" : ""}>
              Verify email
            </li>
          </ol>
        )}

        {googleReturnUser && !verificationUser ? (
          <div className="verification-card">
            <span className="verification-icon" aria-hidden="true">✦</span>
            <h3>One more step: verify you’re human</h3>
            <p>
              Google signed you in, but the security check doesn’t survive a
              redirect. Complete it once more for <strong>{googleReturnUser.email}</strong> to
              finish signing in.
            </p>
            <TurnstileBoundary onRetry={() => setGoogleKey((key) => key + 1)}>
              <TurnstileWidget
                key={googleKey}
                action={formAction}
                resetKey={googleKey}
                onToken={setGoogleToken}
              />
            </TurnstileBoundary>
            <button
              className="button button-primary auth-submit"
              type="button"
              onClick={handleGoogleReturnContinue}
              disabled={busy || !googleToken}
            >
              {busy ? "Please wait…" : "Verify and continue"}
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => setGoogleReturnUser(null)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        ) : verificationUser ? (
          <div className="verification-card">
            <span className="verification-icon" aria-hidden="true">✉</span>
            <h3>Verify your email</h3>
            <p>
              Your account and profile for <strong>{verificationUser.email}</strong> are
              saved. Open the verification link in your inbox to finish — or
              continue to your workspace now and verify from there; sending
              messages stays off until your email is verified.
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
              disabled={busy || resendCooldown > 0}
            >
              {resendCooldown > 0
                ? `Resend verification email (${resendCooldown}s)`
                : "Resend verification email"}
            </button>
            <Link className="button button-outline auth-submit" href="/chat">
              Continue to workspace
            </Link>
          </div>
        ) : showReset ? (
          <form className="auth-form" onSubmit={handlePasswordReset}>
            <h3 className="auth-reset-heading">Reset your password</h3>
            <p className="password-help">
              Enter your account email and complete the security check. If an
              account exists, we’ll email you a reset link.
            </p>
            <label className="form-field">
              <span>Email address</span>
              <input
                type="email"
                name="resetEmail"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={!configured || busy}
                placeholder="you@example.com"
                required
              />
            </label>
            <div className="auth-signup-security">
              <TurnstileBoundary onRetry={() => setResetKey((key) => key + 1)}>
                <TurnstileWidget
                  key={resetKey}
                  action="reset_password"
                  resetKey={resetKey}
                  onToken={setResetToken}
                />
              </TurnstileBoundary>
            </div>
            <button
              className="button button-primary auth-submit"
              type="submit"
              disabled={!configured || busy || !resetToken}
            >
              {busy ? "Please wait…" : "Send reset email"}
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => setShowReset(false)}
              disabled={busy}
            >
              Back to sign in
            </button>
          </form>
        ) : (
          <>
            <div className="auth-signup-security">
              {mode === "sign-up" && (
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
              )}
              <TurnstileBoundary onRetry={resetTurnstile}>
                <TurnstileWidget
                  key={turnstileResetKey}
                  action={formAction}
                  resetKey={turnstileResetKey}
                  onToken={setTurnstileToken}
                />
              </TurnstileBoundary>
            </div>

            <button
              className="button button-google"
              type="button"
              onClick={handleGoogleSignIn}
              disabled={formBlocked}
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

              {mode === "sign-in" && (
                <button
                  className="forgot-password"
                  type="button"
                  onClick={() => {
                    setShowReset(true);
                    setError("");
                  }}
                  disabled={!configured || busy}
                >
                  Forgot password?
                </button>
              )}

              <button
                className="button button-primary auth-submit"
                type="submit"
                disabled={formBlocked}
                aria-busy={busy}
              >
                {busy ? (
                  <>
                    <span className="button-spinner" aria-hidden="true" />
                    {mode === "sign-in" ? "Signing in…" : "Creating your account…"}
                  </>
                ) : (
                  <>
                    {mode === "sign-in" ? "Sign in" : "Create your account"}
                    <span aria-hidden="true">→</span>
                  </>
                )}
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

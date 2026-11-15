"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
import { getDeviceId } from "@/lib/device-fingerprint";

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
  const turnstileAnchorRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verificationUser, setVerificationUser] = useState<User | null>(null);
  const [googleTermsUser, setGoogleTermsUser] = useState<User | null>(null);
  const [googleTermsAccepted, setGoogleTermsAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [signupStep, setSignupStep] = useState<"idle" | "creating" | "verify">("idle");
  const [showReset, setShowReset] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [resetKey, setResetKey] = useState(0);
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

  /** The widget sits under the form fields; bring it into view when a
   * submit is attempted before it has been completed. */
  function scrollToTurnstile() {
    turnstileAnchorRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

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

    // A Google redirect return is only "expected" when this tab
    // actually started one (the flag below). Errors from
    // getRedirectResult with no return in flight — stale state from
    // an old attempt, or a browser that blocks the storage the
    // redirect flow needs — must NEVER surface as a sign-in error on
    // a fresh visit. That was the "We couldn't complete sign-in"
    // banner appearing before the user had tried anything.
    let expectedReturn = false;
    try {
      expectedReturn = sessionStorage.getItem(GOOGLE_REDIRECT_FLAG) !== null;
    } catch {
      expectedReturn = false;
    }

    let active = true;
    let redirectResult: ReturnType<typeof getRedirectResult>;
    try {
      redirectResult = getRedirectResult(getFirebaseAuth());
    } catch (redirectError) {
      if (expectedReturn) setError(getAuthErrorMessage(redirectError));
      return;
    }

    void redirectResult
      .then(async (result) => {
        if (!active) return;
        if (!result?.user) {
          if (expectedReturn) {
            // We sent the user to Google and came back with nothing
            // readable: the browser blocked the return leg's storage.
            try {
              sessionStorage.removeItem(GOOGLE_REDIRECT_FLAG);
            } catch {
              // Nothing to clean up.
            }
            setError(
              "Google sign-in didn’t complete — your browser blocked the return step. Please try again; if it keeps happening, allow cookies for this site or use email sign-in.",
            );
          }
          return;
        }
        // Google sign-ins need no Turnstile check (the server reads
        // the provider from the verified ID token), so a redirect
        // return finishes right here: exchange the token for a
        // session and go straight into the app — no form, no second
        // step. The only thing carried across the redirect is the
        // sign-up terms flag.
        let termsAccepted = false;
        try {
          const raw = sessionStorage.getItem(GOOGLE_REDIRECT_FLAG);
          if (raw) {
            const flag = JSON.parse(raw) as { termsAccepted?: boolean };
            termsAccepted = flag.termsAccepted === true;
          }
          sessionStorage.removeItem(GOOGLE_REDIRECT_FLAG);
        } catch {
          termsAccepted = false;
        }
        setBusy(true);
        setNotice("Finishing sign-in…");
        try {
          const outcome = await establishGoogleSession(result.user, termsAccepted);
          if (!active) return;
          setNotice("");
          if (outcome === "terms") {
            setGoogleTermsUser(result.user);
          } else if (outcome === "ok") {
            await completeSignIn(result.user);
          }
          // "failed": establishGoogleSession already set the error.
        } catch (sessionError) {
          if (active) {
            setNotice("");
            setError(
              sessionError instanceof Error
                ? sessionError.message
                : getAuthErrorMessage(sessionError),
            );
          }
        } finally {
          if (active) setBusy(false);
        }
      })
      .catch((redirectError: unknown) => {
        if (active && expectedReturn) setError(getAuthErrorMessage(redirectError));
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

  /**
   * Exchanges a Google ID token for the server session. Returns
   * "terms" when the server refuses because this is a brand-new
   * account that hasn't accepted the terms yet — the caller then
   * shows the one-time consent card and retries with terms=true.
   * (The sign-in page has no terms checkbox, so without this a
   * first-time Google user was bounced with a dead-end error and
   * no account was ever created.)
   */
  async function establishGoogleSession(
    user: User,
    terms: boolean,
  ): Promise<"ok" | "terms" | "failed"> {
    const idToken = await user.getIdToken();
    const deviceId = await getDeviceId();
    const response = await authFetch("/api/auth/session", {
      idToken,
      action: formAction,
      deviceId: deviceId || undefined,
      termsAccepted: terms,
    });
    if (response.ok) return "ok";
    let code = "";
    let message = "";
    try {
      const data = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      code = data?.error?.code ?? "";
      message = data?.error?.message ?? "";
    } catch {
      // Non-JSON error body: fall through to the generic message.
    }
    if (code === "TERMS_REQUIRED") return "terms";
    setError(message || "We couldn’t finish signing in. Please try again.");
    return "failed";
  }

  async function handleGoogleTermsContinue() {
    if (!googleTermsUser || !googleTermsAccepted) return;
    setBusy(true);
    setError("");
    try {
      const outcome = await establishGoogleSession(googleTermsUser, true);
      if (outcome === "ok") {
        const user = googleTermsUser;
        setGoogleTermsUser(null);
        await completeSignIn(user);
      }
    } catch {
      setError("We couldn’t finish signing in. Please try again.");
    } finally {
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
      scrollToTurnstile();
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
          deviceId: (await getDeviceId()) || undefined,
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
        deviceId: (await getDeviceId()) || undefined,
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
    // No Turnstile for Google, and no checkbox gate either: the
    // human check is Google's own sign-in, and the server confirms
    // the provider from the verified ID token. A brand-new Google
    // account collects its one-time terms consent through the
    // consent card (see establishGoogleSession's "terms" outcome);
    // if the sign-up page's box is already ticked, that consent is
    // passed straight through.
    setError("");
    setNotice("");

    const auth = getFirebaseAuth();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    // Popup first on EVERY device. The redirect flow's return leg
    // depends on cross-site storage that privacy-focused browsers
    // (Brave, strict Safari) often block — users picked their
    // account, landed back on this form, and no account or session
    // was ever created. The popup completes in-page, so the session
    // exchange happens immediately. Redirect stays only as a
    // fallback for environments where a popup genuinely can't run.
    //
    // The popup must open synchronously on the click — no awaits
    // before this call, or browsers block it.
    let popupPromise: ReturnType<typeof signInWithPopup>;
    try {
      popupPromise = signInWithPopup(auth, provider, browserPopupRedirectResolver);
    } catch (popupError) {
      setError(getAuthErrorMessage(popupError));
      return;
    }

    setBusy(true);
    try {
      const credential = await popupPromise;
      const outcome = await establishGoogleSession(credential.user, termsAccepted);
      if (outcome === "terms") {
        // Brand-new Google account via the sign-in page: collect
        // the one-time terms consent, then finish.
        setGoogleTermsUser(credential.user);
        return;
      }
      if (outcome !== "ok") return;
      await completeSignIn(credential.user);
    } catch (popupError) {
      const code = popupError instanceof FirebaseError ? popupError.code : "";
      if (
        code === "auth/popup-blocked" ||
        code === "auth/operation-not-supported-in-this-environment" ||
        code === "auth/web-storage-unsupported" ||
        code === "auth/internal-error" ||
        code === "auth/cancelled-popup-request"
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

        {googleTermsUser ? (
          <div className="verification-card">
            <span className="verification-icon" aria-hidden="true">✓</span>
            <h3>One quick step</h3>
            <p>
              Your Google account <strong>{googleTermsUser.email}</strong> is
              new to Xyro AI. Agree to the terms to finish creating your
              account — you’ll only see this once.
            </p>
            <label className="auth-checkbox-row auth-consent-row">
              <input
                type="checkbox"
                checked={googleTermsAccepted}
                onChange={(event) => {
                  setGoogleTermsAccepted(event.target.checked);
                  setError("");
                }}
                disabled={busy}
              />
              <span>
                I agree to the <Link href="/terms">Terms and Conditions</Link> and have read the{" "}
                <Link href="/privacy">Privacy Policy</Link>.
              </span>
            </label>
            <button
              className="button button-primary auth-submit"
              type="button"
              onClick={handleGoogleTermsContinue}
              disabled={busy || !googleTermsAccepted}
            >
              {busy ? "Please wait…" : "Create my account"}
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setGoogleTermsUser(null);
                setGoogleTermsAccepted(false);
              }}
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
            <button
              className="button button-google"
              type="button"
              onClick={handleGoogleSignIn}
              disabled={!configured || busy}
            >
              <span className="google-mark" aria-hidden="true">G</span>
              <span>Continue with Google</span>
            </button>
            {mode === "sign-up" && (
              <p className="auth-legal">
                By continuing with Google, you agree to our{" "}
                <Link href="/terms">Terms</Link> and{" "}
                <Link href="/privacy">Privacy Policy</Link>.
              </p>
            )}

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

              <label className="form-field password-field">
                <span>Password</span>
                <input
                  type={showPassword ? "text" : "password"}
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
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
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

              <div className="auth-signup-security" ref={turnstileAnchorRef}>
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

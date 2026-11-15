"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import TurnstileBoundary from "@/components/turnstile-boundary";

// Phase 8 (performance): AuthSync is mounted by the root layout on
// every page, including public pages that need no Firebase at all.
// The Firebase SDK is therefore loaded lazily inside the effect
// below — session reconciliation is already fully async, so nothing
// changes semantically — and the Turnstile widget is a dynamic
// import that only loads when a session_refresh check is actually
// needed. The configured check mirrors the four public values
// lib/firebase/client.ts requires, read locally so public pages do
// not download the SDK just to learn it is unconfigured.
const firebaseConfigured = [
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
].every((value) => typeof value === "string" && value.trim().length > 0);

const TurnstileWidget = dynamic(() => import("@/components/turnstile-widget"), {
  ssr: false,
});

// AuthSync (Phase 2) keeps the Firebase client session and the
// Turnstile-gated server session consistent. It is mounted once in
// the root layout.
//
// Session detection: the cookie is HttpOnly, so the client probes
// GET /api/auth/session-status (see that route for why it also
// performs the sliding re-issue). A failed probe (network error,
// deploy in progress, 5xx) means "unknown" and NEVER signs anyone
// out. Sessions end only on: explicit user sign-out, a password
// change, or a SESSION_REVOKED result from the server.
//
// Cases handled here:
//  - Firebase user present, no valid server session → silent renewal:
//    the Turnstile widget runs in interaction-only mode with action
//    session_refresh and the token is exchanged at
//    /api/auth/session. No UI appears unless Cloudflare demands
//    interaction; then a small prompt card is shown.
//  - Server session valid, Firebase user null → the cookie would
//    bounce the browser between /chat and /sign-in forever, so the
//    stale cookie is cleared via POST /api/auth/logout and the user
//    is sent to /sign-in. Guarded to run at most once per 60 s
//    (sessionStorage) and never while already on an auth page flow
//    that is mid-sign-in.
//  - Server reports the session revoked while a Firebase user is
//    present → the local Firebase session is ended too and the user
//    is sent to /sign-in (once, same guard).

const AUTH_PAGE_PREFIXES = ["/sign-in", "/sign-up"];
const LOGOUT_GUARD_KEY = "xyro-authsync-logout-at";
const LOGOUT_GUARD_MS = 60_000;
const FOCUS_RECHECK_MS = 30_000;

type SessionStatus =
  | { state: "authenticated"; uid: string }
  | { state: "signed-out" }
  | { state: "revoked" }
  | { state: "unknown" };

async function fetchSessionStatus(): Promise<SessionStatus> {
  try {
    const response = await fetch("/api/auth/session-status", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return { state: "unknown" };
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) return { state: "unknown" };
    if ("authenticated" in result && result.authenticated === true) {
      return {
        state: "authenticated",
        uid:
          "uid" in result && typeof result.uid === "string" ? result.uid : "",
      };
    }
    if ("revoked" in result && result.revoked === true) return { state: "revoked" };
    return { state: "signed-out" };
  } catch {
    return { state: "unknown" };
  }
}

function logoutGuardActive(): boolean {
  try {
    const raw = sessionStorage.getItem(LOGOUT_GUARD_KEY);
    return raw !== null && Date.now() - Number(raw) < LOGOUT_GUARD_MS;
  } catch {
    return false;
  }
}

function markLogoutGuard(): void {
  try {
    sessionStorage.setItem(LOGOUT_GUARD_KEY, String(Date.now()));
  } catch {
    // Storage unavailable; the in-memory ref guard still applies.
  }
}

export default function AuthSync() {
  const router = useRouter();
  const pathname = usePathname();
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const [refreshIsGoogle, setRefreshIsGoogle] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshToken, setRefreshToken] = useState("");
  const userRef = useRef<User | null>(null);
  const authResolvedRef = useRef(false);
  const checkingRef = useRef(false);
  const handledLogoutRef = useRef(false);
  const lastCheckRef = useRef(0);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const isAuthPage = AUTH_PAGE_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );

  const endLocalSession = useCallback(
    async (clearServerCookie: boolean) => {
      if (handledLogoutRef.current || logoutGuardActive()) return;
      handledLogoutRef.current = true;
      markLogoutGuard();
      if (clearServerCookie) {
        try {
          await fetch("/api/auth/logout", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Requested-With": "xyro",
            },
            body: "{}",
            cache: "no-store",
          });
        } catch {
          // Best effort: the redirect below still breaks the loop for
          // this page load, and the guard prevents a retry storm.
        }
      }
      try {
        const [{ signOut }, { tryGetFirebaseAuth }] = await Promise.all([
          import("firebase/auth"),
          import("@/lib/firebase/auth-client"),
        ]);
        const auth = tryGetFirebaseAuth();
        if (auth?.currentUser) await signOut(auth);
      } catch {
        // Firebase sign-out is best effort here; navigation proceeds.
      }
      if (!AUTH_PAGE_PREFIXES.some((prefix) => pathnameRef.current.startsWith(prefix))) {
        router.replace("/sign-in");
      }
    },
    [router],
  );

  const runCheck = useCallback(async () => {
    if (!authResolvedRef.current || checkingRef.current) return;
    checkingRef.current = true;
    lastCheckRef.current = Date.now();
    try {
      const status = await fetchSessionStatus();
      const user = userRef.current;
      if (status.state === "unknown") return;

      if (status.state === "revoked") {
        // The server ended this session (sign-out elsewhere, password
        // change). End the local Firebase session to match.
        if (user) await endLocalSession(false);
        return;
      }

      if (user && status.state === "signed-out") {
        // Silent renewal — except on the auth pages, where the
        // sign-in form runs its own Turnstile flows and must not be
        // interrupted.
        if (AUTH_PAGE_PREFIXES.some((prefix) => pathnameRef.current.startsWith(prefix))) {
          return;
        }
        // Google accounts renew without a Turnstile check (the
        // server confirms the provider from the ID token); everyone
        // else gets the interaction-only widget below.
        setRefreshIsGoogle(
          user.providerData.some((entry) => entry.providerId === "google.com"),
        );
        setRefreshNeeded(true);
        return;
      }

      if (!user && status.state === "authenticated") {
        await endLocalSession(true);
      }
    } finally {
      checkingRef.current = false;
    }
  }, [endLocalSession]);

  useEffect(() => {
    if (!firebaseConfigured) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const [{ onAuthStateChanged }, { tryGetFirebaseAuth }] =
          await Promise.all([
            import("firebase/auth"),
            import("@/lib/firebase/auth-client"),
          ]);
        if (cancelled) return;
        const auth = tryGetFirebaseAuth();
        if (!auth) return;
        unsubscribe = onAuthStateChanged(
          auth,
          (currentUser) => {
            userRef.current = currentUser;
            authResolvedRef.current = true;
            void runCheck();
          },
          () => {
            // Auth state errors (network, token refresh) never sign
            // anyone out; leave authResolved unset so no check runs.
          },
        );
      } catch {
        // SDK failed to load: leave authResolved unset so no check
        // runs and nobody is signed out (same rule as auth errors).
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [runCheck]);

  useEffect(() => {
    function handleFocus() {
      if (Date.now() - lastCheckRef.current < FOCUS_RECHECK_MS) return;
      void runCheck();
    }
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [runCheck]);

  // Exchange the session_refresh Turnstile token for a fresh session
  // cookie as soon as the interaction-only widget produces one.
  useEffect(() => {
    if (!refreshNeeded || !refreshToken) return;
    let active = true;
    void (async () => {
      const user = userRef.current;
      if (!user) {
        if (active) setRefreshNeeded(false);
        return;
      }
      try {
        const idToken = await user.getIdToken();
        const response = await fetch("/api/auth/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "xyro",
          },
          body: JSON.stringify({
            idToken,
            turnstileToken: refreshToken,
            action: "session_refresh",
          }),
          cache: "no-store",
        });
        if (!active) return;
        if (response.ok) {
          setRefreshNeeded(false);
          setRefreshToken("");
          return;
        }
        // A revoked ID token is the one failure that means the
        // session is really over; anything else (network, Turnstile
        // unavailable, rate limit) leaves the user signed in and the
        // prompt visible for another try.
        const result: unknown = await response.json().catch(() => null);
        const code =
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "object" &&
          result.error !== null &&
          "code" in result.error &&
          typeof result.error.code === "string"
            ? result.error.code
            : "";
        if (code === "SESSION_REVOKED" || code === "AUTH_INVALID") {
          setRefreshNeeded(false);
          await endLocalSession(true);
        }
      } catch {
        // Network error: keep the prompt, never sign out.
      } finally {
        if (active) {
          setRefreshToken("");
          setRefreshKey((key) => key + 1); // tokens are single-use
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [endLocalSession, refreshNeeded, refreshToken]);

  // Tokenless renewal for Google accounts: exchange the ID token
  // for a fresh session cookie as soon as a refresh is needed — no
  // widget, no UI.
  useEffect(() => {
    if (!refreshNeeded || !refreshIsGoogle) return;
    let active = true;
    void (async () => {
      const user = userRef.current;
      if (!user) {
        if (active) setRefreshNeeded(false);
        return;
      }
      try {
        const idToken = await user.getIdToken();
        const response = await fetch("/api/auth/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "xyro",
          },
          body: JSON.stringify({ idToken, action: "session_refresh" }),
          cache: "no-store",
        });
        if (!active) return;
        if (response.ok) {
          setRefreshNeeded(false);
          return;
        }
        const result: unknown = await response.json().catch(() => null);
        const code =
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "object" &&
          result.error !== null &&
          "code" in result.error &&
          typeof result.error.code === "string"
            ? result.error.code
            : "";
        if (code === "SESSION_REVOKED" || code === "AUTH_INVALID") {
          setRefreshNeeded(false);
          await endLocalSession(true);
        }
      } catch {
        // Network error: stay signed in; a later focus re-checks.
      }
    })();
    return () => {
      active = false;
    };
  }, [endLocalSession, refreshNeeded, refreshIsGoogle]);

  if (!refreshNeeded || refreshIsGoogle || isAuthPage) return null;

  return (
    <div className="auth-sync-card" role="status">
      <p>
        <strong>Confirm you’re human</strong>
        <span>Your session needs a quick security check to continue.</span>
      </p>
      <TurnstileBoundary onRetry={() => setRefreshKey((key) => key + 1)}>
        <TurnstileWidget
          key={refreshKey}
          action="session_refresh"
          resetKey={refreshKey}
          onToken={setRefreshToken}
          interactionOnly
        />
      </TurnstileBoundary>
    </div>
  );
}

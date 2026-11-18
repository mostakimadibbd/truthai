"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import SignOutDialog, { type SignOutVariant } from "@/components/sign-out-dialog";

type AuthState = "loading" | "signed-out" | "signed-in" | "error";

// Phase 8 (performance): the header is rendered by the root layout on
// every page, including the public landing and legal pages. It must
// not statically import the Firebase SDK — that pulled ~210 kB (gzip)
// of Firebase chunks into the first load of every public page. The
// SDK is loaded lazily inside the effect below (and performSignOut on
// click); the header already renders a neutral "loading" state until
// the auth state resolves, so the visible behaviour is unchanged.
//
// The configured check mirrors the four public values
// lib/firebase/client.ts requires, read locally so the header does
// not need the SDK just to learn whether it is configured.
const firebaseConfigured = [
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
].every((value) => typeof value === "string" && value.trim().length > 0);

export default function SiteHeader() {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [signOutError, setSignOutError] = useState("");
  const [signOutVariant, setSignOutVariant] = useState<SignOutVariant | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const profileMenuRef = useRef<HTMLDetailsElement>(null);
  const mobileMenuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!firebaseConfigured) {
      setAuthState("signed-out");
      return;
    }

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
        if (!auth) {
          setAuthState("error");
          setSignOutError("Your account status couldn’t be checked.");
          return;
        }

        unsubscribe = onAuthStateChanged(
          auth,
          (currentUser) => {
            setUser(currentUser);
            setAuthState(currentUser ? "signed-in" : "signed-out");
            setSignOutError("");
          },
          (error) => {
            console.error("Xyro AI header authentication state failed.", error);
            setAuthState("error");
            setSignOutError("Your account status couldn’t be checked.");
          },
        );
      } catch {
        if (!cancelled) {
          setAuthState("error");
          setSignOutError("Your account status couldn’t be checked.");
        }
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    function closeMenus(event: PointerEvent) {
      const target = event.target as Node;
      if (profileMenuRef.current && !profileMenuRef.current.contains(target)) {
        profileMenuRef.current.open = false;
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(target)) {
        mobileMenuRef.current.open = false;
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (profileMenuRef.current) profileMenuRef.current.open = false;
        if (mobileMenuRef.current) mobileMenuRef.current.open = false;
      }
    }

    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function openSignOutDialog(variant: SignOutVariant) {
    if (profileMenuRef.current) profileMenuRef.current.open = false;
    setSignOutError("");
    setSignOutVariant(variant);
  }

  async function confirmSignOut() {
    if (!signOutVariant) return;
    setSigningOut(true);
    // performSignOut revokes the server session, tears down Firebase
    // and Firestore locally, and navigates to "/"; it does not return
    // on success because the page unloads. It is imported lazily so
    // the Firestore teardown code stays out of every page's first
    // load (Phase 8); by confirm time the SDK is already loaded.
    const { performSignOut } = await import("@/lib/firebase/sign-out");
    await performSignOut({ allDevices: signOutVariant === "all" });
    setSigningOut(false);
    setSignOutVariant(null);
  }

  const displayName = user?.displayName?.trim() || user?.email || "Your account";
  const initial = displayName.slice(0, 1).toUpperCase();

  function closeProfileMenu() {
    if (profileMenuRef.current) profileMenuRef.current.open = false;
  }

  function closeMobileMenu() {
    if (mobileMenuRef.current) mobileMenuRef.current.open = false;
  }

  return (
    <header className="site-header">
      <Link className="wordmark" href="/chat" aria-label="Xyro AI home">
        <span className="wordmark-icon" aria-hidden="true">x</span>
        <span>xyro<span className="wordmark-light">ai</span></span>
      </Link>
      <nav className="main-nav" aria-label="Main navigation">
        <Link href="/chat">Workspace</Link>
        <Link href="/verify-image">Verify image</Link>
        <Link href="/about">About</Link>
        <Link href="/help">Help</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/faq">FAQ</Link>
      </nav>
      <div className="header-actions">
        {authState === "loading" ? (
          <span className="header-auth-loading" aria-label="Checking account" />
        ) : authState === "signed-in" && user ? (
          <details className="header-profile-menu" ref={profileMenuRef}>
            <summary
              className="header-profile-button"
              aria-label={`Open profile menu for ${displayName}`}
              title={displayName}
            >
              {user.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="header-profile-avatar header-profile-photo" src={user.photoURL} alt="" width={31} height={31} />
              ) : (
                <span className="header-profile-avatar" aria-hidden="true">{initial}</span>
              )}
              <span className="header-profile-name">{displayName}</span>
              <svg aria-hidden="true" viewBox="0 0 16 16">
                <path d="m4 6 4 4 4-4" />
              </svg>
            </summary>
            <div className="header-profile-popover">
              <div className="header-profile-identity">
                {user.photoURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="header-profile-avatar header-profile-photo" src={user.photoURL} alt="" width={31} height={31} />
                ) : (
                  <span className="header-profile-avatar" aria-hidden="true">{initial}</span>
                )}
                <span>
                  <strong>{user.displayName || "Your account"}</strong>
                  <small>{user.email}</small>
                </span>
              </div>
              <Link href="/verify-image" onClick={closeProfileMenu}>
                Verify an image
              </Link>
              <Link href="/settings/profile" onClick={closeProfileMenu}>
                Account
              </Link>
              <Link href="/settings/general" onClick={closeProfileMenu}>
                Settings
              </Link>
              <button type="button" onClick={() => openSignOutDialog("single")}>
                Sign out
              </button>
              <button type="button" onClick={() => openSignOutDialog("all")}>
                Sign out of all devices
              </button>
              {signOutError && <p role="status">{signOutError}</p>}
            </div>
          </details>
        ) : (
          <>
            <Link className="header-signin" href="/sign-in">Sign in</Link>
            <Link className="header-cta" href="/sign-up">
              Get started <span aria-hidden="true">↗</span>
            </Link>
            {signOutError && <span className="header-auth-error" role="status">{signOutError}</span>}
          </>
        )}
      </div>
      <details className="mobile-menu" ref={mobileMenuRef}>
        <summary aria-label="Open navigation menu">
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </summary>
        <nav aria-label="Mobile navigation">
          <Link href="/chat" onClick={closeMobileMenu}>Workspace</Link>
          <Link href="/verify-image" onClick={closeMobileMenu}>Verify image</Link>
          <Link href="/about" onClick={closeMobileMenu}>About</Link>
          <Link href="/help" onClick={closeMobileMenu}>Help</Link>
          <Link href="/pricing" onClick={closeMobileMenu}>Pricing</Link>
          <Link href="/faq" onClick={closeMobileMenu}>FAQ</Link>
          {authState === "signed-in" && (
            <Link href="/settings/profile" onClick={closeMobileMenu}>Account</Link>
          )}
          {authState !== "loading" && authState !== "signed-in" && (
            <>
              <Link href="/sign-in" onClick={closeMobileMenu}>Sign in</Link>
              <Link className="mobile-menu-cta" href="/sign-up" onClick={closeMobileMenu}>
                Get started
              </Link>
            </>
          )}
        </nav>
      </details>
      <SignOutDialog
        open={signOutVariant !== null}
        variant={signOutVariant ?? "single"}
        busy={signingOut}
        onCancel={() => setSignOutVariant(null)}
        onConfirm={confirmSignOut}
      />
    </header>
  );
}

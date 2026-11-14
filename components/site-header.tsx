"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase/auth-client";

type AuthState = "loading" | "signed-out" | "signed-in" | "error";

export default function SiteHeader() {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [signOutError, setSignOutError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const profileMenuRef = useRef<HTMLDetailsElement>(null);
  const mobileMenuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setAuthState("signed-out");
      return;
    }

    return onAuthStateChanged(
      getFirebaseAuth(),
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

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      await signOut(getFirebaseAuth());
      if (profileMenuRef.current) profileMenuRef.current.open = false;
    } catch (error) {
      console.error("Xyro AI sign out failed.", error);
      setSignOutError("We couldn’t sign you out. Please try again.");
    } finally {
      setSigningOut(false);
    }
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
      <Link className="wordmark" href="/" aria-label="Xyro AI home">
        <span className="wordmark-icon" aria-hidden="true">x</span>
        <span>xyro<span className="wordmark-light">ai</span></span>
      </Link>
      <nav className="main-nav" aria-label="Main navigation">
        <Link href="/chat">Workspace</Link>
        <Link href="/about">About</Link>
        <Link href="/help">How it works</Link>
        <Link href="/pricing">Plans</Link>
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
              <span className="header-profile-avatar" aria-hidden="true">{initial}</span>
              <span className="header-profile-name">{displayName}</span>
              <svg aria-hidden="true" viewBox="0 0 16 16">
                <path d="m4 6 4 4 4-4" />
              </svg>
            </summary>
            <div className="header-profile-popover">
              <div className="header-profile-identity">
                <span className="header-profile-avatar" aria-hidden="true">{initial}</span>
                <span>
                  <strong>{user.displayName || "Your account"}</strong>
                  <small>{user.email}</small>
                </span>
              </div>
              <Link href="/account" onClick={closeProfileMenu}>
                Account
              </Link>
              <Link href="/settings" onClick={closeProfileMenu}>
                Settings
              </Link>
              <button type="button" onClick={handleSignOut} disabled={signingOut}>
                {signingOut ? "Signing out…" : "Sign out"}
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
          <Link href="/about" onClick={closeMobileMenu}>About</Link>
          <Link href="/help" onClick={closeMobileMenu}>How it works</Link>
          <Link href="/pricing" onClick={closeMobileMenu}>Plans</Link>
          {authState === "signed-in" && (
            <Link href="/account" onClick={closeMobileMenu}>Account</Link>
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
    </header>
  );
}

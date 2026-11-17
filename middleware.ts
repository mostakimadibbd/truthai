import { NextRequest, NextResponse } from "next/server";
import { verifySessionTokenWebCrypto } from "@/lib/server/session-webcrypto";
import { sanitizeNextPath } from "@/lib/auth-redirect";
import { serverEnv } from "@/lib/server/env";

// Phase 2 session redirects. The middleware verifies ONLY the session
// cookie's signature and expiry (HS256 via Web Crypto — no jose in
// the Edge bundle; see lib/server/session-webcrypto.ts). It
// deliberately makes no Redis or database calls: revocation is
// enforced by the API routes through requireSession; the worst case
// here is a revoked-but-unexpired cookie briefly passing a redirect
// check, after which AuthSync / the APIs end the session properly.
//
//  - Valid cookie on "/", "/sign-in", "/sign-up", "/forgot-password"
//    → redirect to "/chat" (a signed-in user has no use for the
//    landing or auth forms; info/legal pages stay reachable).
//  - No valid cookie on a protected page → redirect to
//    "/sign-in?next=<path>", where the path is the request's own
//    same-origin relative path, re-validated by sanitizeNextPath.

const SESSION_COOKIE_NAMES = ["__Host-xyro_session", "xyro_session"];
const AUTH_ONLY_PAGES = new Set(["/", "/sign-in", "/sign-up", "/forgot-password"]);
const PROTECTED_PREFIXES = [
  "/chat",
  "/settings",
  "/account",
  "/gallery",
  "/projects",
  "/assistants",
  "/admin",
];

async function hasValidSessionCookie(request: NextRequest): Promise<boolean> {
  const secret = serverEnv.sessionSecret;
  if (!secret || secret.length < 32) return false;

  let token: string | undefined;
  for (const name of SESSION_COOKIE_NAMES) {
    token = request.cookies.get(name)?.value;
    if (token) break;
  }
  if (!token) return false;

  // Verified with Web Crypto (lib/server/session-webcrypto.ts)
  // instead of jose, so the Edge bundle stays free of the jose
  // dependency; the check enforces the HS256 signature, `exp`,
  // the sub/sid claims and the absolute-expiry cap — the same
  // contract the Node-side session code verifies.
  return verifySessionTokenWebCrypto(token, secret);
}

export async function middleware(request: NextRequest) {
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = btoa(String.fromCharCode(...nonceBytes));
  const authDomain = serverEnv.firebaseWebAuthDomain;
  const authOrigin = authDomain ? `https://${authDomain}` : "https://*.firebaseapp.com";
  // NOTE: do NOT add "require-trusted-types-for 'script'" here. It breaks
  // Cloudflare Turnstile, which next/script injects by assigning a plain
  // string to HTMLScriptElement.src (Chromium then throws "This document
  // requires 'TrustedScriptURL' assignment" and /sign-up lands on the error
  // screen), and it breaks Firebase Auth Google sign-in, which loads
  // https://apis.google.com/js/api.js the same way and has no Trusted Types
  // support. The nonce-based script-src with 'strict-dynamic' below is the
  // script protection this site relies on instead.
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com https://res.cloudinary.com",
    "font-src 'self' data:",
    `style-src 'self' 'nonce-${nonce}'`,
    `script-src 'self' https://apis.google.com https://challenges.cloudflare.com 'strict-dynamic' 'nonce-${nonce}'`,
    "connect-src 'self' https://api.cloudinary.com https://challenges.cloudflare.com https://*.googleapis.com https://*.firebaseapp.com https://*.firebasedatabase.app https://*.firebaseio.com wss://*.firebasedatabase.app wss://*.firebaseio.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://www.googleapis.com https://firebase.googleapis.com",
    `frame-src 'self' ${authOrigin} https://accounts.google.com https://apis.google.com https://challenges.cloudflare.com`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");

  function applySecurityHeaders(response: NextResponse): NextResponse {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    response.headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(self), geolocation=(), interest-cohort=()",
    );
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (AUTH_ONLY_PAGES.has(pathname) || isProtected) {
    const signedIn = await hasValidSessionCookie(request);
    if (signedIn && AUTH_ONLY_PAGES.has(pathname)) {
      return applySecurityHeaders(
        NextResponse.redirect(new URL("/chat", request.nextUrl.origin)),
      );
    }
    if (!signedIn && isProtected) {
      // The request's own path is same-origin by construction, but run
      // it through the shared validator anyway (defence in depth) and
      // fall back to the protected page itself if anything looks off.
      const next =
        sanitizeNextPath(`${pathname}${request.nextUrl.search}`) ?? pathname;
      const signInUrl = new URL("/sign-in", request.nextUrl.origin);
      signInUrl.searchParams.set("next", next);
      return applySecurityHeaders(NextResponse.redirect(signInUrl));
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  return applySecurityHeaders(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|__/auth).*)"],
};

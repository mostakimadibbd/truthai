import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(`${request.url}-${Date.now()}`).toString("base64");
  const response = NextResponse.next();
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim();
  const authOrigin = authDomain ? `https://${authDomain}` : "https://*.firebaseapp.com";

  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob: https://lh3.googleusercontent.com",
      "font-src 'self' data:",
      `style-src 'self' 'nonce-${nonce}'`,
      `script-src 'self' 'strict-dynamic' 'nonce-${nonce}'`,
      "connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://www.googleapis.com https://firebase.googleapis.com",
      `frame-src 'self' ${authOrigin} https://accounts.google.com https://apis.google.com`,
      "worker-src 'self' blob:",
      "media-src 'self' blob:",
      "manifest-src 'self'",
      "require-trusted-types-for 'script'",
      "trusted-types default",
    ].join("; "),
  );

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js).*)"],
};

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    const firebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
    if (!firebaseProjectId) {
      return [];
    }

    return [
      {
        source: "/__/auth/:path*",
        destination: `https://${firebaseProjectId}.firebaseapp.com/__/auth/:path*`,
      },
    ];
  },
  async headers() {
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
      },
    ];

    const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim();
    const authOrigin = authDomain ? `https://${authDomain}` : "https://*.firebaseapp.com";
    const googleApiOrigins = "https://apis.google.com https://accounts.google.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://www.googleapis.com https://firestore.googleapis.com https://firebase.googleapis.com";

    headers.push(
      {
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "base-uri 'self'",
          "object-src 'none'",
          "frame-ancestors 'none'",
          "form-action 'self'",
          "img-src 'self' data: blob: https://lh3.googleusercontent.com",
          "font-src 'self' data:",
          "style-src 'self' 'unsafe-inline'",
          "script-src 'self' 'strict-dynamic'",
          `connect-src 'self' ${authOrigin} ${googleApiOrigins}`,
          `frame-src 'self' ${authOrigin} https://accounts.google.com https://apis.google.com`,
          "worker-src 'self' blob:",
          "media-src 'self' blob:",
          "manifest-src 'self'",
          "require-trusted-types-for 'script'",
          "trusted-types default",
        ].join("; "),
      },
    );

    return [
      {
        source: "/:path*",
        headers,
      },
    ];
  },
};

export default nextConfig;

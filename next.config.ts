import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      {
        key: "Permissions-Policy",
        value: "camera=(self), microphone=(self), geolocation=()",
      },
    ];

    if (process.env.NODE_ENV === "production") {
      const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim();
      const authOrigin = authDomain
        ? new URL(`https://${authDomain}`).origin
        : "https://*.firebaseapp.com";

      headers.push(
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000",
        },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "style-src 'self' 'unsafe-inline'",
            "script-src 'self' 'unsafe-inline'",
            `connect-src 'self' ${authOrigin} https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://www.googleapis.com https://firebasestorage.googleapis.com https://storage.googleapis.com`,
            `frame-src 'self' ${authOrigin} https://accounts.google.com`,
            "worker-src 'self'",
            "media-src 'self' blob:",
            "manifest-src 'self'",
          ].join("; "),
        },
      );
    }

    return [
      {
        source: "/:path*",
        headers,
      },
    ];
  },
};

export default nextConfig;

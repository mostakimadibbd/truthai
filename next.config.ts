import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // sharp is a native module used by the image watermark path;
  // keep it out of the bundle and load it from node_modules at
  // runtime (Next.js ships it for image optimisation).
  serverExternalPackages: ["sharp"],
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
};

export default nextConfig;

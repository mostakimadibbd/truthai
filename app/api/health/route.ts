import { createPrivateKey } from "node:crypto";
import { NextResponse } from "next/server";
import { normalizeAdminPrivateKey } from "@/lib/server/private-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cheap liveness + configuration probe (Phase 5). Reports only
// booleans — whether each server integration has its configuration
// present — never values, so it is safe to expose publicly. It makes
// no network calls and touches no database, so it stays fast and free
// even when every downstream service is down.
function present(...values: (string | undefined)[]): boolean {
  return values.every((value) => typeof value === "string" && value.trim().length > 0);
}

export async function GET() {
  const integrations = {
    firebaseWeb: present(
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    ),
    firebaseAdmin: present(
      process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      process.env.FIREBASE_ADMIN_PRIVATE_KEY,
      process.env.FIREBASE_ADMIN_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    ),
    realtimeDatabase: present(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL),
    openRouter: present(process.env.OPENROUTER_API_KEY),
    cloudinary: present(
      process.env.CLOUDINARY_CLOUD_NAME,
      process.env.CLOUDINARY_API_KEY,
      process.env.CLOUDINARY_API_SECRET,
    ),
    redis: present(
      process.env.UPSTASH_REDIS_REST_URL,
      process.env.UPSTASH_REDIS_REST_TOKEN,
    ),
    turnstile: present(
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
      process.env.TURNSTILE_SECRET_KEY,
    ),
    session: (process.env.SESSION_SECRET?.trim().length ?? 0) >= 32,
  };
  // Finer-grained Firebase Admin diagnostics (booleans only, never key
  // material): which of the checks in getFirebaseAdminApp would fail.
  // Added after a production incident where "firebaseAdmin: true"
  // (presence) hid an unparseable private key.
  let adminKeyParses = false;
  try {
    const normalized = normalizeAdminPrivateKey(
      process.env.FIREBASE_ADMIN_PRIVATE_KEY,
    );
    if (normalized) {
      createPrivateKey(normalized);
      adminKeyParses = true;
    }
  } catch {
    adminKeyParses = false;
  }
  const adminProjectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const adminChecks = {
    keyParses: adminKeyParses,
    projectMatches:
      !!adminProjectId &&
      adminProjectId === process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim(),
    emailIsServiceAccount:
      process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim().endsWith(
        ".iam.gserviceaccount.com",
      ) ?? false,
  };
  return NextResponse.json(
    { ok: true, integrations, adminChecks },
    { headers: { "Cache-Control": "no-store" } },
  );
}

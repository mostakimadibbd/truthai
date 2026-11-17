import { createPrivateKey } from "node:crypto";
import { NextResponse } from "next/server";
import { normalizeAdminPrivateKey } from "@/lib/server/private-key";
import { checkCloudinaryLive } from "@/lib/server/cloudinary";
import { checkCloudflareLive } from "@/lib/server/cloudflare";
import { serverEnv } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cheap liveness + configuration probe (Phase 5). Reports only
// booleans — whether each server integration has its configuration
// present — never values, so it is safe to expose publicly. All
// environment reads go through lib/server/env.ts, the single place
// server credentials are defined.
function present(...values: (string | undefined)[]): boolean {
  return values.every((value) => typeof value === "string" && value.trim().length > 0);
}

export async function GET() {
  const integrations = {
    firebaseWeb: present(
      serverEnv.firebaseWebApiKey,
      serverEnv.firebaseWebAuthDomain,
      serverEnv.firebaseWebProjectId,
      serverEnv.firebaseWebAppId,
    ),
    firebaseAdmin: present(
      serverEnv.firebaseAdminClientEmail,
      serverEnv.firebaseAdminPrivateKey,
      serverEnv.firebaseAdminProjectId,
    ),
    realtimeDatabase: present(serverEnv.firebaseDatabaseUrl),
    openRouter: present(serverEnv.openRouterApiKey),
    cloudinary: present(
      serverEnv.cloudinaryCloudName,
      serverEnv.cloudinaryApiKey,
      serverEnv.cloudinaryApiSecret,
    ),
    redis: present(serverEnv.upstashRedisUrl, serverEnv.upstashRedisToken),
    turnstile: present(serverEnv.turnstileSiteKey, serverEnv.turnstileSecretKey),
    session: (serverEnv.sessionSecret?.length ?? 0) >= 32,
  };
  // Finer-grained Firebase Admin diagnostics (booleans only, never key
  // material): which of the checks in getFirebaseAdminApp would fail.
  // Added after a production incident where "firebaseAdmin: true"
  // (presence) hid an unparseable private key.
  let adminKeyParses = false;
  try {
    const normalized = normalizeAdminPrivateKey(
      serverEnv.firebaseAdminPrivateKey,
    );
    if (normalized) {
      createPrivateKey(normalized);
      adminKeyParses = true;
    }
  } catch {
    adminKeyParses = false;
  }
  const adminProjectId = serverEnv.firebaseAdminProjectId;
  const adminChecks = {
    keyParses: adminKeyParses,
    projectMatches:
      !!adminProjectId && adminProjectId === serverEnv.firebaseWebProjectId,
    emailIsServiceAccount:
      serverEnv.firebaseAdminClientEmail?.endsWith(
        ".iam.gserviceaccount.com",
      ) ?? false,
  };
  // Upload signing needs a fourth Cloudinary value the presence check
  // above does not cover; a missing preset surfaces to users as
  // "Private file uploads aren't configured for this deployment."
  // Live credential proof (added after an incident where presence
  // checks said "configured" while every image upload failed): one
  // authenticated Admin API call, reported as booleans + a coarse
  // error kind only.
  const cloudinaryLive = await checkCloudinaryLive();
  const cloudinaryChecks = {
    uploadPresetPresent: present(serverEnv.cloudinaryUploadPreset),
    credentialsLive: cloudinaryLive.ok,
    liveError: cloudinaryLive.errorKind,
    creditsPercent: cloudinaryLive.creditsPercent,
  };
  // Cross-provider fallback keys (presence only, never values):
  // lets key setup be verified from the outside without console
  // access. The chat chain uses these when OpenRouter is exhausted.
  const providerKeys = serverEnv.providerEnv();
  const providers = {
    gemini: present(providerKeys.GEMINI_API_KEY) || present(providerKeys.GOOGLE_AI_API_KEY),
    groq: present(providerKeys.GROQ_API_KEY),
    requesty: present(providerKeys.REQUESTY_API_KEY),
    sambanova: present(providerKeys.SAMBANOVA_API_KEY),
    nvidia: present(providerKeys.NVIDIA_API_KEY) || present(providerKeys.NVIDIA_NIM_API_KEY),
    cloudflare:
      present(providerKeys.CLOUDFLARE_API_TOKEN) &&
      present(providerKeys.CLOUDFLARE_ACCOUNT_ID),
  };
  const cloudflareLive = await checkCloudflareLive();
  const cloudflareChecks = {
    configured: cloudflareLive.configured,
    credentialsLive: cloudflareLive.live,
    liveError: cloudflareLive.errorKind,
  };
  return NextResponse.json(
    { ok: true, integrations, adminChecks, cloudinaryChecks, cloudflareChecks, providers },
    { headers: { "Cache-Control": "no-store" } },
  );
}

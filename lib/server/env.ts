/**
 * THE single place server code reads environment credentials from.
 *
 * Every API key, token, secret and connection string the server
 * uses is exposed here as a lazy getter — values are read at call
 * time, never cached at module load, so behaviour matches direct
 * process.env reads exactly (including in tests that set variables
 * per-case). To rotate or fix a credential, this file is the map of
 * what exists and where it is used; the values themselves live only
 * in the deployment's environment, never in the repo.
 *
 * Scope: server-side credentials. Client components keep reading
 * NEXT_PUBLIC_* variables directly — those are public web config
 * inlined at build time, not credentials. Platform flags that are
 * not credentials (NODE_ENV, VERCEL_ENV, XYRO_TEST_* overrides)
 * also stay local to the code they switch.
 */

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Every env var name a cross-provider fallback key may live under. */
export const PROVIDER_ENV_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_AI_API_KEY",
  "GROQ_API_KEY",
  "REQUESTY_API_KEY",
  "SAMBANOVA_API_KEY",
  "NVIDIA_API_KEY",
  "NVIDIA_NIM_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
] as const;

export const serverEnv = {
  // Session signing + device/IP HMACs.
  get sessionSecret() {
    return read("SESSION_SECRET");
  },

  // OpenRouter (primary AI provider).
  get openRouterApiKey() {
    return read("OPENROUTER_API_KEY");
  },

  /** Snapshot of the cross-provider key variables, for the
   * fallback chain's target builder (which takes an env record). */
  providerEnv(): Record<string, string | undefined> {
    const record: Record<string, string | undefined> = {};
    for (const name of PROVIDER_ENV_KEYS) record[name] = process.env[name];
    return record;
  },

  // Cloudinary (all image storage).
  get cloudinaryCloudName() {
    return read("CLOUDINARY_CLOUD_NAME");
  },
  get cloudinaryApiKey() {
    return read("CLOUDINARY_API_KEY");
  },
  get cloudinaryApiSecret() {
    return read("CLOUDINARY_API_SECRET");
  },
  get cloudinaryUploadPreset() {
    return read("CLOUDINARY_UPLOAD_PRESET");
  },

  // Firebase Admin (service account).
  get firebaseAdminProjectId() {
    return (
      read("FIREBASE_ADMIN_PROJECT_ID") ??
      read("NEXT_PUBLIC_FIREBASE_PROJECT_ID")
    );
  },
  get firebaseAdminClientEmail() {
    return read("FIREBASE_ADMIN_CLIENT_EMAIL");
  },
  /** Raw on purpose: normalizeAdminPrivateKey accepts every paste
   * form (escaped newlines, quotes, collapsed lines) itself. */
  get firebaseAdminPrivateKey() {
    return process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  },

  // Firebase web config — public identifiers, but read server-side
  // too (health checks, admin project matching), so they live here
  // alongside everything else.
  get firebaseWebApiKey() {
    return read("NEXT_PUBLIC_FIREBASE_API_KEY");
  },
  get firebaseWebAuthDomain() {
    return read("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
  },
  get firebaseWebProjectId() {
    return read("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  },
  get firebaseWebAppId() {
    return read("NEXT_PUBLIC_FIREBASE_APP_ID");
  },
  get firebaseDatabaseUrl() {
    return read("NEXT_PUBLIC_FIREBASE_DATABASE_URL");
  },

  // Upstash Redis (rate limits, session revocation).
  get upstashRedisUrl() {
    return process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
  },
  get upstashRedisToken() {
    return process.env.UPSTASH_REDIS_REST_TOKEN;
  },

  // Cloudflare Turnstile (bot verification).
  get turnstileSecretKey() {
    return read("TURNSTILE_SECRET_KEY");
  },
  get turnstileSiteKey() {
    return read("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  },

  /** Hostnames Turnstile tokens are accepted from, beyond the
   * production URL — configuration, kept with the other Turnstile
   * values so the whole integration reads from one place. */
  get turnstileHostnameAllowlist() {
    return process.env.TURNSTILE_HOSTNAME_ALLOWLIST ?? "";
  },
  get productionUrl() {
    return read("VERCEL_PROJECT_PRODUCTION_URL");
  },

  // Image generation sources (all optional, env-gated).
  get geminiApiKey() {
    return read("GEMINI_API_KEY") ?? read("GOOGLE_AI_API_KEY");
  },
  get cloudflareAccountId() {
    return read("CLOUDFLARE_ACCOUNT_ID");
  },
  get cloudflareApiToken() {
    return read("CLOUDFLARE_API_TOKEN");
  },
  get pollinationsToken() {
    return read("POLLINATIONS_TOKEN");
  },
  get aiHordeApiKey() {
    return read("AIHORDE_API_KEY");
  },

  // Python backend delegation.
  get backendUrl() {
    return read("BACKEND_URL")?.replace(/\/+$/, "");
  },
  get backendServiceToken() {
    return read("BACKEND_SERVICE_TOKEN");
  },
};

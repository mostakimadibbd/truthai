import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { DeviceContext } from "@/lib/server/device";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";

/**
 * Developer platform data: activation profile, API keys, daily
 * usage and per-request fingerprint events — all in Firestore, all
 * written server-side.
 *
 *   users/{uid}/developerProfile/main   activation answers + plan
 *   users/{uid}/apiKeys/{keyId}         key records (hash only)
 *   apiKeys/{keyHash}                   top-level auth lookup
 *   users/{uid}/apiUsage/{yyyy-mm-dd}   daily token/request rollup
 *   users/{uid}/apiEvents/{eventId}     per-request fingerprint log
 *
 * Keys are shown in full exactly once (at creation). Only their
 * SHA-256 hash is stored, so a database leak does not leak usable
 * keys. The free plan allows FREE_PLAN_DAILY_TOKEN_LIMIT tokens
 * per day, enforced from the daily rollup before each call.
 */

export const FREE_PLAN_DAILY_TOKEN_LIMIT = 100_000;
export const MAX_ACTIVE_API_KEYS = 5;
export const API_KEY_PREFIX = "xyro_sk_live_";

export const API_USE_CASES = [
  "chatbot",
  "ai-assistant",
  "website-integration",
  "mobile-app",
  "automation",
  "content-generation",
  "customer-support",
  "research",
  "other",
] as const;

export const API_BUILDER_TYPES = [
  "individual",
  "hobbyist",
  "student",
  "startup",
  "company",
  "agency",
] as const;

export const API_LANGUAGES = ["javascript", "python", "curl", "other"] as const;

export type DeveloperProfile = {
  projectName: string;
  useCase: string;
  builderType: string;
  language: string;
  website: string | null;
  plan: "free";
  createdAt: number;
};

export type ApiKeyRecord = {
  keyId: string;
  name: string;
  displayPrefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revoked: boolean;
};

export type DailyUsage = {
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type ApiEventRecord = {
  id: string;
  createdAt: number;
  keyPrefix: string | null;
  endpoint: string;
  model: string | null;
  status: string;
  httpStatus: number;
  totalTokens: number;
  deviceLabel: string | null;
};

/* ------------------------------ keys ------------------------------ */

const BASE62 =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function generateApiKey(): string {
  const bytes = randomBytes(32);
  let suffix = "";
  for (const byte of bytes) suffix += BASE62[byte % BASE62.length];
  return API_KEY_PREFIX + suffix;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function apiKeyDisplayPrefix(key: string): string {
  return `${key.slice(0, API_KEY_PREFIX.length + 4)}…${key.slice(-4)}`;
}

function db() {
  return getFirebaseAdminFirestore();
}

function profileRef(uid: string) {
  return db()
    .collection("users")
    .doc(uid)
    .collection("developerProfile")
    .doc("main");
}

function keysCollection(uid: string) {
  return db().collection("users").doc(uid).collection("apiKeys");
}

function usageRef(uid: string, date: string) {
  return db().collection("users").doc(uid).collection("apiUsage").doc(date);
}

function eventsCollection(uid: string) {
  return db().collection("users").doc(uid).collection("apiEvents");
}

function toMillis(value: unknown): number {
  if (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof (value as { toMillis: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

/* ---------------------------- profile ----------------------------- */

export type ActivationInput = {
  projectName: string;
  useCase: string;
  builderType: string;
  language: string;
  website: string | null;
};

export function validateActivationInput(body: Record<string, unknown>):
  | { ok: true; value: ActivationInput }
  | { ok: false; message: string } {
  const projectName =
    typeof body.projectName === "string" ? body.projectName.trim() : "";
  if (projectName.length < 2 || projectName.length > 60) {
    return { ok: false, message: "Give your project a name (2–60 characters)." };
  }
  if (
    typeof body.useCase !== "string" ||
    !(API_USE_CASES as readonly string[]).includes(body.useCase)
  ) {
    return { ok: false, message: "Choose what you are building." };
  }
  if (
    typeof body.builderType !== "string" ||
    !(API_BUILDER_TYPES as readonly string[]).includes(body.builderType)
  ) {
    return { ok: false, message: "Choose what best describes you." };
  }
  if (
    typeof body.language !== "string" ||
    !(API_LANGUAGES as readonly string[]).includes(body.language)
  ) {
    return { ok: false, message: "Choose your primary language." };
  }
  let website: string | null = null;
  if (typeof body.website === "string" && body.website.trim().length > 0) {
    const candidate = body.website.trim();
    if (candidate.length > 200) {
      return { ok: false, message: "That website address is too long." };
    }
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("protocol");
      }
      website = url.toString();
    } catch {
      return { ok: false, message: "That website address isn’t valid." };
    }
  }
  if (body.termsAccepted !== true) {
    return {
      ok: false,
      message: "Accept the API terms to activate developer access.",
    };
  }
  return {
    ok: true,
    value: {
      projectName,
      useCase: body.useCase,
      builderType: body.builderType,
      language: body.language,
      website,
    },
  };
}

export async function getDeveloperProfile(
  uid: string,
): Promise<DeveloperProfile | null> {
  const snapshot = await profileRef(uid).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() ?? {};
  return {
    projectName:
      typeof data.projectName === "string" ? data.projectName : "Project",
    useCase: typeof data.useCase === "string" ? data.useCase : "other",
    builderType:
      typeof data.builderType === "string" ? data.builderType : "individual",
    language: typeof data.language === "string" ? data.language : "javascript",
    website: typeof data.website === "string" ? data.website : null,
    plan: "free",
    createdAt: toMillis(data.createdAt),
  };
}

export async function activateDeveloper(
  uid: string,
  input: ActivationInput,
): Promise<void> {
  await profileRef(uid).set(
    {
      ...input,
      plan: "free",
      termsAcceptedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: false },
  );
}

/* --------------------------- key CRUD ----------------------------- */

export async function createApiKey(
  uid: string,
  name: string,
): Promise<{ record: ApiKeyRecord; fullKey: string }> {
  const existing = await keysCollection(uid)
    .where("revoked", "==", false)
    .get();
  if (existing.size >= MAX_ACTIVE_API_KEYS) {
    throw new Error("KEY_LIMIT");
  }
  const fullKey = generateApiKey();
  const keyHash = hashApiKey(fullKey);
  const keyRef = keysCollection(uid).doc();
  const record: ApiKeyRecord = {
    keyId: keyRef.id,
    name: name.slice(0, 60) || "API key",
    displayPrefix: apiKeyDisplayPrefix(fullKey),
    createdAt: Date.now(),
    lastUsedAt: null,
    revoked: false,
  };
  const batch = db().batch();
  batch.set(keyRef, {
    name: record.name,
    displayPrefix: record.displayPrefix,
    keyHash,
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: null,
    revoked: false,
  });
  batch.set(db().collection("apiKeys").doc(keyHash), {
    uid,
    keyId: keyRef.id,
  });
  await batch.commit();
  return { record, fullKey };
}

export async function listApiKeys(uid: string): Promise<ApiKeyRecord[]> {
  const snapshot = await keysCollection(uid)
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      keyId: doc.id,
      name: typeof data.name === "string" ? data.name : "API key",
      displayPrefix:
        typeof data.displayPrefix === "string" ? data.displayPrefix : "xyro_sk_live_…",
      createdAt: toMillis(data.createdAt),
      lastUsedAt: data.lastUsedAt ? toMillis(data.lastUsedAt) : null,
      revoked: data.revoked === true,
    };
  });
}

export async function revokeApiKey(
  uid: string,
  keyId: string,
): Promise<boolean> {
  const keyRef = keysCollection(uid).doc(keyId);
  const snapshot = await keyRef.get();
  if (!snapshot.exists) return false;
  const keyHash = snapshot.data()?.keyHash;
  const batch = db().batch();
  batch.update(keyRef, { revoked: true });
  if (typeof keyHash === "string") {
    batch.delete(db().collection("apiKeys").doc(keyHash));
  }
  await batch.commit();
  return true;
}

/**
 * Authenticates an Authorization header against the key store.
 * Returns the owner + key identity, or null. Touches lastUsedAt at
 * most once every 5 minutes per key.
 */
export async function authenticateApiKey(
  authorization: string | null,
): Promise<{ uid: string; keyId: string; displayPrefix: string } | null> {
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  const key = authorization.slice("Bearer ".length).trim();
  if (!key.startsWith(API_KEY_PREFIX) || key.length > 80) return null;
  const lookup = await db()
    .collection("apiKeys")
    .doc(hashApiKey(key))
    .get();
  if (!lookup.exists) return null;
  const { uid, keyId } = lookup.data() as { uid: string; keyId: string };
  if (typeof uid !== "string" || typeof keyId !== "string") return null;
  const keyRef = keysCollection(uid).doc(keyId);
  const keySnapshot = await keyRef.get();
  if (!keySnapshot.exists || keySnapshot.data()?.revoked === true) {
    return null;
  }
  const data = keySnapshot.data() ?? {};
  const lastUsedMs = data.lastUsedAt ? toMillis(data.lastUsedAt) : 0;
  if (Date.now() - lastUsedMs > 5 * 60 * 1000) {
    void keyRef
      .update({ lastUsedAt: FieldValue.serverTimestamp() })
      .catch(() => undefined);
  }
  return {
    uid,
    keyId,
    displayPrefix:
      typeof data.displayPrefix === "string"
        ? data.displayPrefix
        : "xyro_sk_live_…",
  };
}

/* ----------------------------- usage ------------------------------ */

export function apiDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function emptyUsage(date: string): DailyUsage {
  return { date, requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function usageFromDoc(date: string, data: FirebaseFirestore.DocumentData | undefined): DailyUsage {
  if (!data) return emptyUsage(date);
  return {
    date,
    requests: typeof data.requests === "number" ? data.requests : 0,
    promptTokens: typeof data.promptTokens === "number" ? data.promptTokens : 0,
    completionTokens:
      typeof data.completionTokens === "number" ? data.completionTokens : 0,
    totalTokens: typeof data.totalTokens === "number" ? data.totalTokens : 0,
  };
}

export async function getDailyUsage(
  uid: string,
  date: string,
): Promise<DailyUsage> {
  const snapshot = await usageRef(uid, date).get();
  return usageFromDoc(date, snapshot.data());
}

export async function getUsageRange(
  uid: string,
  days: number,
): Promise<DailyUsage[]> {
  const dates: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    dates.push(apiDateKey(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  const snapshots = await db().getAll(
    ...dates.map((date) => usageRef(uid, date)),
  );
  return snapshots.map((snapshot, index) =>
    usageFromDoc(dates[index], snapshot.data()),
  );
}

export async function listApiEvents(
  uid: string,
  limit = 10,
): Promise<ApiEventRecord[]> {
  const snapshot = await eventsCollection(uid)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      createdAt: toMillis(data.createdAt),
      keyPrefix: typeof data.keyPrefix === "string" ? data.keyPrefix : null,
      endpoint: typeof data.endpoint === "string" ? data.endpoint : "",
      model: typeof data.model === "string" ? data.model : null,
      status: typeof data.status === "string" ? data.status : "success",
      httpStatus: typeof data.httpStatus === "number" ? data.httpStatus : 200,
      totalTokens: typeof data.totalTokens === "number" ? data.totalTokens : 0,
      deviceLabel: typeof data.deviceLabel === "string" ? data.deviceLabel : null,
    };
  });
}

/**
 * Records one API call: increments the daily rollup and appends the
 * fingerprinted request event (device label, parsed UA, IP hash,
 * coarse geo — never a raw IP). Best-effort by contract: metering
 * must never fail a completed model call.
 */
export async function recordApiCall(
  uid: string,
  info: {
    keyId: string;
    keyPrefix: string;
    endpoint: string;
    model: string | null;
    status: "success" | "error" | "rejected";
    httpStatus: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    tokensEstimated: boolean;
    context: DeviceContext;
    city: string | null;
    country: string | null;
  },
): Promise<void> {
  try {
    const date = apiDateKey();
    const batch = db().batch();
    batch.set(
      usageRef(uid, date),
      {
        date,
        requests: FieldValue.increment(1),
        promptTokens: FieldValue.increment(info.promptTokens),
        completionTokens: FieldValue.increment(info.completionTokens),
        totalTokens: FieldValue.increment(info.totalTokens),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    batch.set(eventsCollection(uid).doc(), {
      keyId: info.keyId,
      keyPrefix: info.keyPrefix,
      endpoint: info.endpoint,
      model: info.model,
      status: info.status,
      httpStatus: info.httpStatus,
      promptTokens: info.promptTokens,
      completionTokens: info.completionTokens,
      totalTokens: info.totalTokens,
      tokensEstimated: info.tokensEstimated,
      deviceId: info.context.deviceId,
      deviceLabel: info.context.label,
      browser: info.context.browser,
      os: info.context.os,
      deviceType: info.context.deviceType,
      userAgent: info.context.userAgent,
      ipHash: info.context.ipHash,
      city: info.city,
      country: info.country,
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    console.error("Couldn’t record API usage.", error);
  }
}

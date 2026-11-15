import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { DeviceContext } from "@/lib/server/device";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";
import { estimateCostUsd, getModelPricing } from "@/lib/server/models";
import { recordUsageEvent } from "@/lib/server/analytics";

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
 *   users/{uid}/apiModelUsage/{id}      per-model daily totals
 *   users/{uid}/apiAccessPoints/{id}    fingerprinted API origins
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

export const API_CALL_ENVIRONMENTS = [
  "server-backend",
  "serverless",
  "mobile-backend",
  "script",
  "other",
] as const;

export const API_EXPECTED_USAGE = [
  "testing",
  "under-1k",
  "1k-10k",
  "over-10k",
] as const;

export const API_HEARD_FROM = [
  "search",
  "social",
  "friend",
  "blog",
  "other",
] as const;

export type DeveloperProfile = {
  projectName: string;
  useCase: string;
  builderType: string;
  language: string;
  callEnvironment: string;
  expectedUsage: string;
  heardFrom: string | null;
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
  costUsd: number;
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
  costUsd: number;
  deviceLabel: string | null;
  promptPreview: string | null;
  inputLog: string | null;
  outputLog: string | null;
};

export type ModelUsage = {
  model: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type ApiAccessPoint = {
  id: string;
  deviceLabel: string | null;
  browser: string | null;
  os: string | null;
  deviceType: string | null;
  city: string | null;
  country: string | null;
  keyPrefix: string | null;
  requests: number;
  firstSeenAt: number;
  lastSeenAt: number;
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
  callEnvironment: string;
  expectedUsage: string;
  heardFrom: string | null;
  website: string | null;
};

/**
 * Resolves one selectable answer: either one of the preset ids, or
 * "other" together with a written answer in `<field>Custom`
 * (2–80 chars), which is then stored as the answer itself.
 */
function selectable(
  body: Record<string, unknown>,
  field: string,
  presets: readonly string[],
  question: string,
):
  | { ok: true; value: string }
  | { ok: false; message: string } {
  const raw = body[field];
  if (typeof raw === "string" && presets.includes(raw) && raw !== "other") {
    return { ok: true, value: raw };
  }
  if (raw === "other") {
    const custom = body[`${field}Custom`];
    const text = typeof custom === "string" ? custom.trim() : "";
    if (text.length < 2 || text.length > 80) {
      return {
        ok: false,
        message: `Choose “Other” answers need a short written answer (2–80 characters) for: ${question}`,
      };
    }
    return { ok: true, value: text };
  }
  return { ok: false, message: `Answer the question: ${question}` };
}

export function validateActivationInput(body: Record<string, unknown>):
  | { ok: true; value: ActivationInput }
  | { ok: false; message: string } {
  const projectName =
    typeof body.projectName === "string" ? body.projectName.trim() : "";
  if (projectName.length < 2 || projectName.length > 60) {
    return { ok: false, message: "Give your project a name (2–60 characters)." };
  }
  const useCase = selectable(body, "useCase", API_USE_CASES, "What are you building?");
  if (!useCase.ok) return useCase;
  const builderType = selectable(body, "builderType", API_BUILDER_TYPES, "What best describes you?");
  if (!builderType.ok) return builderType;
  const language = selectable(body, "language", API_LANGUAGES, "Primary language");
  if (!language.ok) return language;
  const callEnvironment = selectable(
    body,
    "callEnvironment",
    API_CALL_ENVIRONMENTS,
    "Where will you call the API from?",
  );
  if (!callEnvironment.ok) return callEnvironment;
  if (
    typeof body.expectedUsage !== "string" ||
    !(API_EXPECTED_USAGE as readonly string[]).includes(body.expectedUsage)
  ) {
    return { ok: false, message: "Choose your expected daily usage." };
  }
  // Optional question: absent/empty is fine; "other" needs the text.
  let heardFrom: string | null = null;
  if (typeof body.heardFrom === "string" && body.heardFrom.length > 0) {
    const resolved = selectable(body, "heardFrom", API_HEARD_FROM, "Where did you hear about Xyro AI?");
    if (!resolved.ok) return resolved;
    heardFrom = resolved.value;
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
      useCase: useCase.value,
      builderType: builderType.value,
      language: language.value,
      callEnvironment: callEnvironment.value,
      expectedUsage: body.expectedUsage,
      heardFrom,
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
    callEnvironment:
      typeof data.callEnvironment === "string" ? data.callEnvironment : "server-backend",
    expectedUsage:
      typeof data.expectedUsage === "string" ? data.expectedUsage : "testing",
    heardFrom: typeof data.heardFrom === "string" ? data.heardFrom : null,
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
  return {
    date,
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
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
    costUsd: typeof data.costUsd === "number" ? data.costUsd : 0,
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
      costUsd: typeof data.costUsd === "number" ? data.costUsd : 0,
      deviceLabel: typeof data.deviceLabel === "string" ? data.deviceLabel : null,
      promptPreview: typeof data.promptPreview === "string" ? data.promptPreview : null,
      inputLog: typeof data.inputLog === "string" ? data.inputLog : null,
      outputLog: typeof data.outputLog === "string" ? data.outputLog : null,
    };
  });
}

function modelUsageCollection(uid: string) {
  return db().collection("users").doc(uid).collection("apiModelUsage");
}

function accessPointsCollection(uid: string) {
  return db().collection("users").doc(uid).collection("apiAccessPoints");
}

/** Per-model totals across the last `days` days, busiest first. */
export async function listApiModelUsage(
  uid: string,
  days: number,
): Promise<ModelUsage[]> {
  const start = apiDateKey(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));
  const snapshot = await modelUsageCollection(uid)
    .where("date", ">=", start)
    .get();
  const byModel = new Map<string, ModelUsage>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const model = typeof data.model === "string" ? data.model : "unknown";
    const entry = byModel.get(model) ?? {
      model,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    };
    entry.requests += typeof data.requests === "number" ? data.requests : 0;
    entry.promptTokens += typeof data.promptTokens === "number" ? data.promptTokens : 0;
    entry.completionTokens +=
      typeof data.completionTokens === "number" ? data.completionTokens : 0;
    entry.totalTokens += typeof data.totalTokens === "number" ? data.totalTokens : 0;
    entry.costUsd += typeof data.costUsd === "number" ? data.costUsd : 0;
    byModel.set(model, entry);
  }
  return [...byModel.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

/** Where and how the API is being called from, busiest access last-seen first. */
export async function listApiAccessPoints(
  uid: string,
  limit = 20,
): Promise<ApiAccessPoint[]> {
  const snapshot = await accessPointsCollection(uid)
    .orderBy("lastSeenAt", "desc")
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      deviceLabel: typeof data.deviceLabel === "string" ? data.deviceLabel : null,
      browser: typeof data.browser === "string" ? data.browser : null,
      os: typeof data.os === "string" ? data.os : null,
      deviceType: typeof data.deviceType === "string" ? data.deviceType : null,
      city: typeof data.city === "string" ? data.city : null,
      country: typeof data.country === "string" ? data.country : null,
      keyPrefix: typeof data.keyPrefix === "string" ? data.keyPrefix : null,
      requests: typeof data.requests === "number" ? data.requests : 0,
      firstSeenAt: toMillis(data.firstSeenAt),
      lastSeenAt: toMillis(data.lastSeenAt),
    };
  });
}

const LOG_CAP_CHARS = 8_000;

function capLog(text: string | null): string | null {
  if (text === null) return null;
  return text.length > LOG_CAP_CHARS
    ? `${text.slice(0, LOG_CAP_CHARS)}…[truncated]`
    : text;
}

/**
 * Records one API call, all server-side:
 *  - the daily rollup (requests / tokens / estimated cost),
 *  - the fingerprinted request event, including the request input
 *    and response output logs (capped) — disclosed in the API terms
 *    and visible to the account owner in the dashboard,
 *  - the per-model daily totals,
 *  - the access point: a fingerprint of the calling client
 *    (IP hash + user agent) with its detected coarse location.
 * Raw IPs are never stored. Best-effort by contract: metering must
 * never fail a completed model call.
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
    input: { role: string; content: string }[] | null;
    output: string | null;
  },
): Promise<void> {
  try {
    const date = apiDateKey();
    const costUsd = info.model
      ? estimateCostUsd(
          await getModelPricing(info.model),
          info.promptTokens,
          info.completionTokens,
        )
      : 0;

    let inputLog: string | null = null;
    let promptPreview: string | null = null;
    if (info.input) {
      inputLog = capLog(JSON.stringify(info.input));
      const lastUser = [...info.input]
        .reverse()
        .find((message) => message.role === "user");
      if (lastUser) promptPreview = lastUser.content.slice(0, 240);
    }
    const outputLog = capLog(info.output);

    // The access point is keyed by the client fingerprint; read it
    // first so firstSeenAt is only written on the first sighting.
    const accessPointId = createHash("sha256")
      .update(`${info.context.ipHash ?? "no-ip"}|${info.context.userAgent}`)
      .digest("hex")
      .slice(0, 40);
    const accessPointRef = accessPointsCollection(uid).doc(accessPointId);
    const accessPointSnap = await accessPointRef.get().catch(() => null);

    const batch = db().batch();
    batch.set(
      usageRef(uid, date),
      {
        date,
        requests: FieldValue.increment(1),
        promptTokens: FieldValue.increment(info.promptTokens),
        completionTokens: FieldValue.increment(info.completionTokens),
        totalTokens: FieldValue.increment(info.totalTokens),
        costUsd: FieldValue.increment(costUsd),
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
      costUsd,
      promptPreview,
      inputLog,
      outputLog,
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
    if (info.model) {
      const modelDocId = `${date}__${info.model.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      batch.set(
        modelUsageCollection(uid).doc(modelDocId),
        {
          date,
          model: info.model,
          requests: FieldValue.increment(1),
          promptTokens: FieldValue.increment(info.promptTokens),
          completionTokens: FieldValue.increment(info.completionTokens),
          totalTokens: FieldValue.increment(info.totalTokens),
          costUsd: FieldValue.increment(costUsd),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    batch.set(
      accessPointRef,
      {
        deviceLabel: info.context.label,
        browser: info.context.browser,
        os: info.context.os,
        deviceType: info.context.deviceType,
        userAgent: info.context.userAgent,
        ipHash: info.context.ipHash,
        city: info.city,
        country: info.country,
        keyId: info.keyId,
        keyPrefix: info.keyPrefix,
        requests: FieldValue.increment(1),
        lastSeenAt: FieldValue.serverTimestamp(),
        ...(accessPointSnap && !accessPointSnap.exists
          ? { firstSeenAt: FieldValue.serverTimestamp() }
          : {}),
      },
      { merge: true },
    );
    await batch.commit();

    // Platform analytics (admin-only): the same call lands in the
    // token ledger and the per-minute/daily rollups.
    await recordUsageEvent({
      uid,
      surface: "api",
      model: info.model,
      promptTokens: info.promptTokens,
      completionTokens: info.completionTokens,
      status: info.status,
      tokensEstimated: info.tokensEstimated,
    });
  } catch (error) {
    console.error("Couldn’t record API usage.", error);
  }
}

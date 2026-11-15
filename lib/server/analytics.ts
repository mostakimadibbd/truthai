import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";
import { estimateCostUsd, getModelPricing } from "@/lib/server/models";

/**
 * Platform analytics (admin-only). Every metered AI call — chat
 * turn, public API call, image creation — is recorded here in the
 * background, independently of the user's own data:
 *
 *   usageEvents/{id}                        per-request token ledger
 *   analytics_minutes/{yyyy-mm-ddTHH:mm}    platform totals/minute
 *   analytics_days/{yyyy-mm-dd}             platform totals/day
 *   analytics_model_minutes/{minute}__{m}   per-model, per minute
 *   analytics_model_days/{date}__{m}        per-model, per day
 *   analytics_user_days/{date}__{uid}       per-user, per day
 *   users/{uid}/chatUsage/{date}            the user's own chat
 *                                           metering (Usage tab)
 *
 * The rollups are keyed by UTC minute and day, so cost and token
 * flow ("where did the tokens go": which surface, which model,
 * which user, prompt vs completion) can be charted per minute and
 * per second (the ledger carries millisecond timestamps). These
 * collections live at the top level on purpose: deleting a chat —
 * or a whole account — never deletes the operational record, and
 * Firestore rules deny every client access; only the server (and
 * therefore the admin console) can read them.
 *
 * Recording is best-effort by contract: analytics must never fail
 * or slow down the request being metered.
 */

export type UsageSurface = "chat" | "api" | "image";

export type UsageTotals = {
  requests: number;
  chatRequests: number;
  apiRequests: number;
  imageRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
};

const ZERO_TOTALS: UsageTotals = {
  requests: 0,
  chatRequests: 0,
  apiRequests: 0,
  imageRequests: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  costUsd: 0,
};

export function analyticsDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function analyticsMinuteKey(date = new Date()): string {
  return date.toISOString().slice(0, 16);
}

function sanitizeModelId(model: string): string {
  return model.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function db() {
  return getFirebaseAdminFirestore();
}

export type UsageEventInput = {
  uid: string;
  surface: UsageSurface;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  chatId?: string | null;
  status?: string;
  tokensEstimated?: boolean;
};

/** Records one metered call into the ledger + every rollup. */
export async function recordUsageEvent(input: UsageEventInput): Promise<void> {
  try {
    const now = new Date();
    const day = analyticsDayKey(now);
    const minute = analyticsMinuteKey(now);
    const promptTokens = Math.max(0, Math.floor(input.promptTokens));
    const completionTokens = Math.max(0, Math.floor(input.completionTokens));
    const totalTokens = promptTokens + completionTokens;
    const costUsd = input.model
      ? estimateCostUsd(
          await getModelPricing(input.model),
          promptTokens,
          completionTokens,
        )
      : 0;

    const surfaceCounter =
      input.surface === "chat"
        ? "chatRequests"
        : input.surface === "api"
          ? "apiRequests"
          : "imageRequests";
    const totals = {
      requests: FieldValue.increment(1),
      [surfaceCounter]: FieldValue.increment(1),
      promptTokens: FieldValue.increment(promptTokens),
      completionTokens: FieldValue.increment(completionTokens),
      totalTokens: FieldValue.increment(totalTokens),
      costUsd: FieldValue.increment(costUsd),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const firestore = db();
    const batch = firestore.batch();

    batch.set(firestore.collection("usageEvents").doc(), {
      uid: input.uid,
      surface: input.surface,
      model: input.model,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd,
      chatId: input.chatId ?? null,
      status: input.status ?? "success",
      tokensEstimated: input.tokensEstimated ?? false,
      ts: now.getTime(),
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(
      firestore.collection("analytics_minutes").doc(minute),
      { minute, ...totals },
      { merge: true },
    );
    batch.set(
      firestore.collection("analytics_days").doc(day),
      { day, ...totals },
      { merge: true },
    );
    batch.set(
      firestore.collection("analytics_user_days").doc(`${day}__${input.uid}`),
      {
        day,
        uid: input.uid,
        ...totals,
        lastSeenAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    if (input.model) {
      const modelTotals = {
        model: input.model,
        requests: FieldValue.increment(1),
        promptTokens: FieldValue.increment(promptTokens),
        completionTokens: FieldValue.increment(completionTokens),
        totalTokens: FieldValue.increment(totalTokens),
        costUsd: FieldValue.increment(costUsd),
        updatedAt: FieldValue.serverTimestamp(),
      };
      batch.set(
        firestore
          .collection("analytics_model_minutes")
          .doc(`${minute}__${sanitizeModelId(input.model)}`),
        { minute, ...modelTotals },
        { merge: true },
      );
      batch.set(
        firestore
          .collection("analytics_model_days")
          .doc(`${day}__${sanitizeModelId(input.model)}`),
        { day, ...modelTotals },
        { merge: true },
      );
    }
    if (input.surface === "chat") {
      batch.set(
        firestore
          .collection("users")
          .doc(input.uid)
          .collection("chatUsage")
          .doc(day),
        {
          date: day,
          requests: FieldValue.increment(1),
          promptTokens: FieldValue.increment(promptTokens),
          completionTokens: FieldValue.increment(completionTokens),
          totalTokens: FieldValue.increment(totalTokens),
          costUsd: FieldValue.increment(costUsd),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      // Per-chat daily rollup (owner request, 2026-11-16): Settings →
      // Usage shows today's tokens broken down by conversation, with
      // the model(s) each conversation used. Models are stored as
      // VALUES (arrayUnion + lastModel), never as field names, so
      // model ids containing "/" and "." are safe.
      if (input.chatId) {
        batch.set(
          firestore
            .collection("users")
            .doc(input.uid)
            .collection("chatUsageByDay")
            .doc(day)
            .collection("chats")
            .doc(input.chatId),
          {
            chatId: input.chatId,
            requests: FieldValue.increment(1),
            promptTokens: FieldValue.increment(promptTokens),
            completionTokens: FieldValue.increment(completionTokens),
            totalTokens: FieldValue.increment(totalTokens),
            ...(input.model
              ? {
                  models: FieldValue.arrayUnion(input.model),
                  lastModel: input.model,
                }
              : {}),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }

    await batch.commit();
  } catch (error) {
    console.error("Couldn’t record usage analytics.", error);
  }
}

/* ------------------------------ readers ------------------------------ */

function totalsFromDoc(
  data: FirebaseFirestore.DocumentData | undefined,
): UsageTotals {
  if (!data) return { ...ZERO_TOTALS };
  const num = (value: unknown) => (typeof value === "number" ? value : 0);
  return {
    requests: num(data.requests),
    chatRequests: num(data.chatRequests),
    apiRequests: num(data.apiRequests),
    imageRequests: num(data.imageRequests),
    promptTokens: num(data.promptTokens),
    completionTokens: num(data.completionTokens),
    totalTokens: num(data.totalTokens),
    costUsd: num(data.costUsd),
  };
}

export async function getAnalyticsDayTotals(
  day: string,
): Promise<UsageTotals> {
  const snapshot = await db().collection("analytics_days").doc(day).get();
  return totalsFromDoc(snapshot.data());
}

export type MinutePoint = { minute: string } & UsageTotals;

/** The last `count` minute buckets, oldest first, gaps zero-filled. */
export async function getAnalyticsMinuteSeries(
  count = 60,
): Promise<MinutePoint[]> {
  const keys: string[] = [];
  const now = Date.now();
  for (let i = count - 1; i >= 0; i--) {
    keys.push(analyticsMinuteKey(new Date(now - i * 60_000)));
  }
  const firestore = db();
  const snapshots = await firestore.getAll(
    ...keys.map((key) => firestore.collection("analytics_minutes").doc(key)),
  );
  return keys.map((key, index) => ({
    minute: key,
    ...totalsFromDoc(snapshots[index].data()),
  }));
}

export type ModelDayTotal = {
  model: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
};

export async function getAnalyticsModelDay(day: string): Promise<ModelDayTotal[]> {
  const snapshot = await db()
    .collection("analytics_model_days")
    .where("day", "==", day)
    .get();
  const num = (value: unknown) => (typeof value === "number" ? value : 0);
  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        model: typeof data.model === "string" ? data.model : "unknown",
        requests: num(data.requests),
        promptTokens: num(data.promptTokens),
        completionTokens: num(data.completionTokens),
        totalTokens: num(data.totalTokens),
        costUsd: num(data.costUsd),
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

export type UserDayTotal = { uid: string } & UsageTotals;

export async function getAnalyticsTopUsers(
  day: string,
  limit = 10,
): Promise<UserDayTotal[]> {
  const snapshot = await db()
    .collection("analytics_user_days")
    .where("day", "==", day)
    .get();
  return snapshot.docs
    .map((doc) => ({
      uid: typeof doc.data().uid === "string" ? (doc.data().uid as string) : doc.id,
      ...totalsFromDoc(doc.data()),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, limit);
}

export type UsageLedgerEntry = {
  id: string;
  ts: number;
  uid: string;
  surface: string;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  status: string;
};

export async function getRecentUsageEvents(
  limit = 50,
): Promise<UsageLedgerEntry[]> {
  const snapshot = await db()
    .collection("usageEvents")
    .orderBy("ts", "desc")
    .limit(limit)
    .get();
  const num = (value: unknown) => (typeof value === "number" ? value : 0);
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      ts: num(data.ts),
      uid: typeof data.uid === "string" ? data.uid : "",
      surface: typeof data.surface === "string" ? data.surface : "",
      model: typeof data.model === "string" ? data.model : null,
      promptTokens: num(data.promptTokens),
      completionTokens: num(data.completionTokens),
      totalTokens: num(data.totalTokens),
      costUsd: num(data.costUsd),
      status: typeof data.status === "string" ? data.status : "success",
    };
  });
}

/* --------------------------- user-facing --------------------------- */

export type ChatDailyUsage = {
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type ChatTodayUsage = {
  chatId: string;
  title: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  models: string[];
};

/**
 * Today's chat tokens broken down per conversation (Usage tab),
 * with each conversation's title and the model(s) it used. Reads
 * the per-chat rollup written by recordUsageEvent; titles come
 * from the chat docs themselves ("Deleted chat" when gone).
 */
export async function getTodayChatUsageByChat(
  uid: string,
): Promise<ChatTodayUsage[]> {
  const firestore = db();
  const day = analyticsDayKey(new Date());
  const snapshot = await firestore
    .collection("users")
    .doc(uid)
    .collection("chatUsageByDay")
    .doc(day)
    .collection("chats")
    .orderBy("totalTokens", "desc")
    .limit(20)
    .get();
  if (snapshot.empty) return [];
  const num = (value: unknown) => (typeof value === "number" ? value : 0);
  const titleSnapshots = await firestore.getAll(
    ...snapshot.docs.map((doc) =>
      firestore.collection("users").doc(uid).collection("chats").doc(doc.id),
    ),
  );
  return snapshot.docs.map((doc, index) => {
    const data = doc.data();
    const titleData = titleSnapshots[index]?.data();
    return {
      chatId: doc.id,
      title:
        typeof titleData?.title === "string" && titleData.title
          ? titleData.title
          : titleSnapshots[index]?.exists
            ? "Untitled chat"
            : "Deleted chat",
      requests: num(data.requests),
      promptTokens: num(data.promptTokens),
      completionTokens: num(data.completionTokens),
      totalTokens: num(data.totalTokens),
      models: Array.isArray(data.models)
        ? data.models.filter((model): model is string => typeof model === "string")
        : [],
    };
  });
}

/** The signed-in user's own chat metering for the Usage tab. */
export async function getChatUsageRange(
  uid: string,
  days: number,
): Promise<ChatDailyUsage[]> {
  const dates: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    dates.push(analyticsDayKey(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  const firestore = db();
  const snapshots = await firestore.getAll(
    ...dates.map((date) =>
      firestore.collection("users").doc(uid).collection("chatUsage").doc(date),
    ),
  );
  const num = (value: unknown) => (typeof value === "number" ? value : 0);
  return snapshots.map((snapshot, index) => {
    const data = snapshot.data();
    return {
      date: dates[index],
      requests: num(data?.requests),
      promptTokens: num(data?.promptTokens),
      completionTokens: num(data?.completionTokens),
      totalTokens: num(data?.totalTokens),
      costUsd: num(data?.costUsd),
    };
  });
}

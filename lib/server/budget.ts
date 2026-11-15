import { redisPipeline } from "@/lib/server/redis";

// Daily budget guard (Phase 4).
//
// The free tiers set the real ceiling on this product:
//  - Firestore Spark: 50k reads and 20k writes per day. Writes are
//    the binding budget for a chat product (every turn writes a user
//    message, an assistant message and chat metadata), so the guard
//    is driven by the WRITE estimate; reads are tracked and reported
//    but do not trigger queue/pause.
//  - Upstash free: 500k commands per month ≈ 16,667 per day. Tracked
//    as an estimate (each instrumented request adds the number of
//    Redis round trips its path is known to make) and reported, but
//    not used for queue/pause — the per-route limiters already bound
//    Redis usage per user.
//
// Estimate model (documented, deliberately simple):
//  - /api/chat turn: 5 Firestore writes (batch: user message +
//    assistant placeholder + chat update; final: assistant update +
//    chat update; +1 on regenerate for the deleted old reply),
//    reads = 2 + history docs read + attachment docs read.
//  - POST /api/chats: 1 write, 1 read. PATCH chat: 1 write, 1 read.
//    DELETE chat: writes = 1 (chat doc) + deleted message docs +
//    deleted upload docs, reads = 1 + upload docs read.
//  - POST /api/uploads/confirm: 1 write, 1 read.
//  - Redis estimate per instrumented request: 4 commands (session
//    revocation pipeline + rate-limit check + this budget call is
//    the right order of magnitude; it is an estimate, not metering).
//
// Cost of the guard itself: recording is ONE EVAL in one pipeline
// call (the same trick lib/server/rate-limit.ts uses for its
// minute+day counters), which increments the three daily counters,
// anchors their 24 h expiry, and returns the totals. Status reads
// use one EVAL too and are cached in memory for 30 s per instance.
// So the guard adds at most one Redis round trip per instrumented
// request. When Redis is not configured the guard is skipped with a
// warning — it must never become a new single point of failure (the
// chat rate limiter already fails closed on its own when Redis is
// down).

export const FIRESTORE_WRITE_BUDGET_PER_DAY = 20_000;
export const FIRESTORE_READ_BUDGET_PER_DAY = 50_000;
export const REDIS_COMMAND_BUDGET_PER_DAY = 16_667;

export const BUDGET_QUEUE_PERCENT = 85;
export const BUDGET_PAUSE_PERCENT = 95;

// Test-only override of the Firestore write budget, so the queue /
// pause thresholds can be exercised locally without 17k writes. It
// is IGNORED in production (VERCEL_ENV=production), where the real
// Spark quota always applies.
function firestoreWriteBudget(): number {
  if (process.env.VERCEL_ENV !== "production") {
    const override = Number(process.env.XYRO_TEST_BUDGET_FS_WRITES);
    if (Number.isInteger(override) && override > 0) return override;
  }
  return FIRESTORE_WRITE_BUDGET_PER_DAY;
}

function dayKeys(): [string, string, string] {
  const day = new Date().toISOString().slice(0, 10); // UTC day
  return [
    `xyro:budget:${day}:firestore-writes`,
    `xyro:budget:${day}:firestore-reads`,
    `xyro:budget:${day}:redis-commands`,
  ];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const RECORD_SCRIPT = `
local writes = redis.call('INCRBY', KEYS[1], tonumber(ARGV[1]))
if writes == tonumber(ARGV[1]) then redis.call('PEXPIRE', KEYS[1], ARGV[4]) end
local reads = redis.call('INCRBY', KEYS[2], tonumber(ARGV[2]))
if reads == tonumber(ARGV[2]) then redis.call('PEXPIRE', KEYS[2], ARGV[4]) end
local cmds = redis.call('INCRBY', KEYS[3], tonumber(ARGV[3]))
if cmds == tonumber(ARGV[3]) then redis.call('PEXPIRE', KEYS[3], ARGV[4]) end
return {writes, reads, cmds}
`;

const READ_SCRIPT = `
return {
  tonumber(redis.call('GET', KEYS[1]) or '0'),
  tonumber(redis.call('GET', KEYS[2]) or '0'),
  tonumber(redis.call('GET', KEYS[3]) or '0')
}
`;

export type BudgetState = "ok" | "queue" | "paused" | "skipped";

export type BudgetStatus = {
  state: BudgetState;
  /** Percent of today's Firestore write budget consumed (null if skipped). */
  firestoreWritePercent: number | null;
  firestoreReadPercent: number | null;
  redisPercent: number | null;
  firestoreWrites: number | null;
};

const SKIPPED: BudgetStatus = {
  state: "skipped",
  firestoreWritePercent: null,
  firestoreReadPercent: null,
  redisPercent: null,
  firestoreWrites: null,
};

let cachedStatus: { at: number; status: BudgetStatus } | null = null;
const STATUS_CACHE_MS = 30_000;

function toStatus(writes: number, reads: number, redis: number): BudgetStatus {
  const firestoreWritePercent = (writes / firestoreWriteBudget()) * 100;
  const state: BudgetState =
    firestoreWritePercent >= BUDGET_PAUSE_PERCENT
      ? "paused"
      : firestoreWritePercent >= BUDGET_QUEUE_PERCENT
        ? "queue"
        : "ok";
  return {
    state,
    firestoreWritePercent,
    firestoreReadPercent: (reads / FIRESTORE_READ_BUDGET_PER_DAY) * 100,
    redisPercent: (redis / REDIS_COMMAND_BUDGET_PER_DAY) * 100,
    firestoreWrites: writes,
  };
}

function parseTotals(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const numbers = value.map((entry) =>
    typeof entry === "number" ? entry : NaN,
  );
  if (numbers.some((entry) => !Number.isFinite(entry) || entry < 0)) return null;
  return [numbers[0], numbers[1], numbers[2]];
}

/** Read today's counters (cached 30 s per instance). */
export async function getBudgetStatus(): Promise<BudgetStatus> {
  const now = Date.now();
  if (cachedStatus && now - cachedStatus.at < STATUS_CACHE_MS) {
    return cachedStatus.status;
  }
  const [writesKey, readsKey, redisKey] = dayKeys();
  const result = await redisPipeline([
    ["EVAL", READ_SCRIPT, "3", writesKey, readsKey, redisKey],
  ]);
  if (result.state !== "ok") {
    if (result.state === "unconfigured") {
      console.warn("Budget guard is not configured (Upstash missing); skipping budget checks.");
    }
    // A failed read never blocks traffic on its own.
    return SKIPPED;
  }
  const totals = parseTotals(result.results[0]);
  if (!totals) return SKIPPED;
  const status = toStatus(...totals);
  cachedStatus = { at: now, status };
  return status;
}

/**
 * Record estimated consumption for one request (one EVAL in one
 * pipeline call). Never throws into the request path; returns the
 * fresh status when available and refreshes the cache.
 */
export async function recordBudget(usage: {
  firestoreWrites?: number;
  firestoreReads?: number;
  redisCommands?: number;
}): Promise<BudgetStatus> {
  const [writesKey, readsKey, redisKey] = dayKeys();
  const result = await redisPipeline([
    [
      "EVAL",
      RECORD_SCRIPT,
      "3",
      writesKey,
      readsKey,
      redisKey,
      String(Math.max(0, Math.floor(usage.firestoreWrites ?? 0))),
      String(Math.max(0, Math.floor(usage.firestoreReads ?? 0))),
      String(Math.max(0, Math.floor(usage.redisCommands ?? 0))),
      String(DAY_MS),
    ],
  ]);
  if (result.state !== "ok") {
    if (result.state === "unconfigured") {
      console.warn("Budget guard is not configured (Upstash missing); usage not recorded.");
    } else {
      console.warn("Budget guard couldn't record usage (Redis unavailable).");
    }
    return SKIPPED;
  }
  const totals = parseTotals(result.results[0]);
  if (!totals) return SKIPPED;
  const status = toStatus(...totals);
  cachedStatus = { at: Date.now(), status };
  return status;
}

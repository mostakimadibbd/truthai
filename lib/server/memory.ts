import { Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";

/**
 * ChatGPT-style long-term memory (2026-11-17). The assistant can
 * remember durable facts about the user across conversations:
 *
 *  - Storage: users/{uid}/memories/{id} documents, written ONLY
 *    by the server (rules deny client writes; the owner reads
 *    them for the Settings list via the /api/memory route).
 *  - Recall: at the start of a chat turn the saved facts ride in
 *    a system block, together with the save protocol below.
 *  - Capture: the model ends its reply with hidden
 *    [[memory: <fact>]] markers when it learns something durable.
 *    The server strips the markers from everything the user
 *    sees or that gets stored as the reply, and saves the facts.
 *    This costs no extra model call — precious on a free quota.
 *  - Control: Settings → Personalization lists every memory,
 *    lets the user add their own, delete any, clear all, or turn
 *    memory off entirely (the memoryEnabled preference).
 */

export const MEMORY_LIMIT = 100;
export const MEMORY_TEXT_MAX = 200;
const MEMORY_INJECT_MAX_CHARS = 2400;

export type MemoryEntry = {
  id: string;
  text: string;
  source: "auto" | "user";
  createdAt: number | null;
};

export function sanitizeMemoryText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\[\[|\]\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MEMORY_TEXT_MAX);
}

export function normalizeMemoryKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Categories that must NEVER be stored as memories (owner
 * requirement): health, finances, government/financial
 * identifiers, and credentials or secrets. A fact that matches
 * is rejected at save time — for model-captured facts and for
 * facts the user types themselves — because long-term memory is
 * replayed into future prompts and sent to model providers;
 * sensitive data does not belong there.
 */
const SENSITIVE_MEMORY_PATTERNS: RegExp[] = [
  // Credentials and secrets.
  /\b(password|passcode|api[\s_-]?key|secret[\s_-]?key|access[\s_-]?token|credential)s?\b/i,
  /\bmy\s+(password|pin|passcode)\b/i,
  /\bpin\s*(is|:|=)\s*\d/i,
  // Government and financial identifiers.
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN-shaped
  /\b(?:\d[ -]?){13,19}\b/, // long digit runs: cards, accounts
  /\b(passport|national\s+id|driver'?s\s+licen[cs]e|tax\s+id|social\s+security|ssn)\b/i,
  /\b(bank\s+account|account\s+number|routing\s+number|iban|sort\s+code|credit\s+card|debit\s+card)\b/i,
  // Finances.
  /\b(salary|wages|income|paycheck)\b[^.]{0,40}(\$|€|£|\d)/i,
  /\b(earns|makes|owes|debt\s+of|loan\s+of|borrowed)\b[^.]{0,30}(\$|€|£|\d)/i,
  /\bbank\s+balance\b/i,
  // Health.
  /\b(diagnosed|diagnosis|diabetes|cancer|hiv|aids|epilepsy|hypertension|blood\s+pressure|chemotherapy|prescription|medication|dosage|pregnan\w+|mental\s+health|depression|anxiety\s+disorder|adhd|autism)\b/i,
  /\b\d+\s?(mg|mcg)\b[^.]{0,30}\b(daily|twice|once|tablet|dose|pill)\b/i,
];

export function isSensitiveMemory(text: string): boolean {
  return SENSITIVE_MEMORY_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Whether this turn may capture memories at all. Turns that
 * carry web results or file text NEVER capture: that content is
 * third-party text, so a [[memory:]] marker echoed from it is
 * an injection vector, and "facts" read out of a document or a
 * web page are not the user's own durable facts.
 */
export function shouldCaptureMemories(args: {
  enabled: boolean;
  webContext: boolean;
  attachmentCount: number;
}): boolean {
  return args.enabled && !args.webContext && args.attachmentCount === 0;
}

const MEMORY_MARKER = /\[\[memory:\s*([^\]]{1,240})\]\]/gi;

/** Pull [[memory: …]] markers out of a reply; returns the clean text + facts. */
export function extractMemories(text: string): {
  cleanText: string;
  memories: string[];
} {
  const memories: string[] = [];
  const cleanText = text
    .replace(MEMORY_MARKER, (_match, fact: string) => {
      const clean = sanitizeMemoryText(fact);
      if (clean) memories.push(clean);
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return { cleanText, memories };
}

/**
 * What the live stream may show while a reply is still arriving:
 * complete markers stripped, and everything from a possible
 * unterminated marker start held back so a half-typed
 * "[[memory:" never flashes on screen.
 */
export function liveVisibleText(text: string): string {
  const { cleanText } = extractMemories(text);
  const tailStart = cleanText.lastIndexOf("[[");
  if (tailStart >= 0 && !cleanText.slice(tailStart).includes("]]")) {
    return cleanText.slice(0, tailStart).trimEnd();
  }
  return cleanText;
}

export async function listMemories(uid: string): Promise<MemoryEntry[]> {
  const db = getFirebaseAdminFirestore();
  const snapshot = await db
    .collection("users")
    .doc(uid)
    .collection("memories")
    .orderBy("createdAt", "desc")
    .limit(MEMORY_LIMIT)
    .get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    const createdAt = data.createdAt as { toMillis?: () => number } | undefined;
    return {
      id: doc.id,
      text: typeof data.text === "string" ? data.text : "",
      source: data.source === "user" ? ("user" as const) : ("auto" as const),
      createdAt:
        createdAt && typeof createdAt.toMillis === "function"
          ? createdAt.toMillis()
          : null,
    };
  });
}

/**
 * The system block for a chat turn: the facts themselves plus
 * the save protocol. Kept compact — every character rides along
 * on every turn.
 */
export function memorySystemBlock(memories: string[]): string {
  const facts = memories
    .map((text) => `- ${text}`)
    .join("\n")
    .slice(0, MEMORY_INJECT_MAX_CHARS);
  return [
    "Long-term memory — things you remember about this user from earlier conversations. Use them naturally when relevant; never recite the list unprompted:",
    facts || "(nothing saved yet)",
    "When you learn a NEW durable fact about the user that would help future conversations (their name, work, projects, preferences, important people, goals, constraints), save it by ending your reply with a line [[memory: the fact in one short sentence]]. At most two per reply, only genuinely durable facts — never temporary details, never anything already listed above, and never mention this mechanism or the markers to the user. NEVER save health information, financial details, ID or account numbers, passwords, PINs or any other credentials or secrets, even if the user mentions them.",
  ].join("\n");
}

/**
 * Save new facts, skipping duplicates, sensitive categories and
 * respecting the cap. Returns the entries actually saved (with
 * their ids) so the chat UI can show a "Saved to memory" chip
 * with Undo for each one.
 */
export async function saveMemories(
  uid: string,
  facts: string[],
  source: "auto" | "user",
  chatId?: string,
): Promise<{ id: string; text: string }[]> {
  const clean = facts
    .map(sanitizeMemoryText)
    .filter(Boolean)
    .filter((text) => !isSensitiveMemory(text));
  if (!clean.length) return [];
  const db = getFirebaseAdminFirestore();
  const ref = db.collection("users").doc(uid).collection("memories");
  const existing = await ref.limit(MEMORY_LIMIT).get();
  const seen = new Set(
    existing.docs.map((doc) => normalizeMemoryKey(String(doc.data().text ?? ""))),
  );
  const saved: { id: string; text: string }[] = [];
  for (const text of clean) {
    if (existing.size + saved.length >= MEMORY_LIMIT) break;
    const key = normalizeMemoryKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const doc = await ref.add({
      text,
      source,
      ...(chatId ? { chatId } : {}),
      createdAt: Timestamp.now(),
    });
    saved.push({ id: doc.id, text });
  }
  return saved;
}

export async function deleteMemory(uid: string, id: string): Promise<boolean> {
  const db = getFirebaseAdminFirestore();
  const ref = db.collection("users").doc(uid).collection("memories").doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) return false;
  await ref.delete();
  return true;
}

export async function clearMemories(uid: string): Promise<number> {
  const db = getFirebaseAdminFirestore();
  const ref = db.collection("users").doc(uid).collection("memories");
  const snapshot = await ref.limit(500).get();
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return snapshot.size;
}

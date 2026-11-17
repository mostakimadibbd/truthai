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
    "When you learn a NEW durable fact about the user that would help future conversations (their name, work, projects, preferences, important people, goals, constraints), save it by ending your reply with a line [[memory: the fact in one short sentence]]. At most two per reply, only genuinely durable facts — never temporary details, never anything already listed above, and never mention this mechanism or the markers to the user.",
  ].join("\n");
}

/** Save new facts, skipping duplicates and respecting the cap. */
export async function saveMemories(
  uid: string,
  facts: string[],
  source: "auto" | "user",
  chatId?: string,
): Promise<number> {
  const clean = facts.map(sanitizeMemoryText).filter(Boolean);
  if (!clean.length) return 0;
  const db = getFirebaseAdminFirestore();
  const ref = db.collection("users").doc(uid).collection("memories");
  const existing = await ref.limit(MEMORY_LIMIT).get();
  const seen = new Set(
    existing.docs.map((doc) => normalizeMemoryKey(String(doc.data().text ?? ""))),
  );
  let saved = 0;
  for (const text of clean) {
    if (existing.size + saved >= MEMORY_LIMIT) break;
    const key = normalizeMemoryKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    await ref.add({
      text,
      source,
      ...(chatId ? { chatId } : {}),
      createdAt: Timestamp.now(),
    });
    saved += 1;
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

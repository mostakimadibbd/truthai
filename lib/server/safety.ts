import { Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";

/**
 * Safety flagging (2026-11-17). Two silent signals mark an
 * account for admin review when someone asks the AI for
 * seriously harmful or illegal help:
 *
 *  1. prompt_pattern — the user's own message matches a
 *     high-confidence harmful-request pattern (intent + object,
 *     so ordinary conversation about the same nouns is not
 *     flagged: "how to protect my account from hackers" and
 *     "how to make a bath bomb" are fine).
 *  2. model_refusal — the answering model itself refused on
 *     safety grounds.
 *
 * A flag NEVER affects the user: no message, no limit, no
 * visible change — they keep using the AI normally. Flags land
 * in the server-only `safetyFlags` collection for the admin
 * panel, where an admin reviews them and decides (dismiss, or
 * act through the existing user controls). Python parity:
 * backend/app/safety.py — keep the patterns in sync.
 */

export type SafetyCategory =
  | "weapons"
  | "illicit-drugs"
  | "cybercrime"
  | "fraud"
  | "violent-wrongdoing"
  | "sexual-exploitation"
  | "other";

const INTENT =
  /\b(how\s+to|how\s+do\s+i|how\s+can\s+i|instructions?\s+(for|to)|tutorial|guide\s+to|recipe\s+for|steps\s+to|ways?\s+to|teach\s+me|show\s+me\s+how|make|build|create|construct|cook|synthesize|manufacture|write|generate|get\s+away\s+with)\b/i;

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

const CATEGORY_OBJECTS: { category: SafetyCategory; objects: RegExp }[] = [
  {
    category: "weapons",
    objects:
      /\b(pipe\s+bomb|pressure\s+cooker\s+bomb|bomb|explosive\s+device|grenade|landmine|molotov|detonator|silencer|chemical\s+weapon|nerve\s+(gas|agent)|sarin|ricin|anthrax|tnt|napalm|improvised\s+explosive|ied)\b/i,
  },
  {
    category: "illicit-drugs",
    objects:
      /\b(methamphetamine|meth|heroin|fentanyl|cocaine|crack\s+cocaine|lsd|drug\s+lab)\b/i,
  },
  {
    category: "cybercrime",
    objects:
      /\b(hack\s+into|hacking\s+into|bypass\s+(a\s+|the\s+|someone'?s\s+)?(password|login|2fa|two[\s-]factor|security)|steal\s+(passwords?|credentials?|accounts?|sessions?|cookies?)|phishing\s+(page|site|email|kit|attack)|keylogger|ransomware|malware|ddos|brute[\s-]force\s+(attack|password|login)|crack\s+(a\s+|the\s+|someone'?s\s+)?(password|account|wifi)|carding|credit\s+card\s+dumps?|botnet)\b/i,
  },
  {
    category: "fraud",
    objects:
      /\b(fake\s+(id|passport|documents?|currency|money|bills?)|counterfeit\s+(money|currency|bills?|documents?)|money\s+laundering|launder\s+money|forge\s+(a\s+|the\s+)?(signature|documents?|passport)|scam\s+(people|users|customers|victims)|ponzi|steal\s+money\s+from)\b/i,
  },
  {
    category: "violent-wrongdoing",
    objects:
      /\b(kill\s+(a\s+person|someone|my\s+\w+|him|her|them)|murder\s+(a\s+person|someone|my\s+\w+|him|her|them)|poison\s+(a\s+person|someone|my\s+\w+|him|her|them)|strangle|assassinate|get\s+away\s+with\s+(murder|a\s+crime|killing))\b/i,
  },
];

const MINOR_INDICATOR =
  /\b(child|children|minor|underage|preteen|pre-teen|schoolgirl|schoolboy|young\s+girl|young\s+boy|1[0-7]\s*(years?[\s-]?old|yo|y\/o))\b/i;
const SEXUAL_TERMS =
  /\b(sex|sexual|nude|naked|porn|erotic|nsfw|undress|explicit)\b/i;

/** Classify a user message; null when it is not a
 * high-confidence harmful request. */
export function classifyHarmfulRequest(
  text: string,
): { category: SafetyCategory } | null {
  const sample = text.slice(0, 4000);
  if (has(sample, MINOR_INDICATOR) && has(sample, SEXUAL_TERMS)) {
    return { category: "sexual-exploitation" };
  }
  if (!INTENT.test(sample)) return null;
  // "Bath bomb" is a cosmetics staple, not a weapon: scrub the
  // phrase before the weapons objects are matched (a real bomb
  // request elsewhere in the message still matches).
  const scrubbed = sample.replace(/\bbath\s+bombs?\b/gi, "cosmetic");
  for (const entry of CATEGORY_OBJECTS) {
    const target = entry.category === "weapons" ? scrubbed : sample;
    if (entry.objects.test(target)) {
      return { category: entry.category };
    }
  }
  return null;
}

const SAFETY_REFUSAL_PATTERNS: RegExp[] = [
  /\bi (?:can'?t|cannot|can not|won'?t|will not) (?:help|assist|comply|provide|generate|create|write|give)\b[^.]{0,80}\b(?:illegal|harmful|dangerous|weapon|drug|hack|fraud|violent|violence|exploit|wrongdoing|policy|guideline|unethical)/i,
  /\bi (?:can'?t|cannot|can not) (?:help|assist) with (?:that|this)\b/i,
  /\b(?:against|violates?|violation of) (?:my|our|the) (?:policy|policies|guidelines|terms)\b/i,
  /\bi'?m (?:not able|unable) to (?:help|assist|provide|comply)\b[^.]{0,60}\b(?:illegal|harmful|dangerous)/i,
  /\bthis (?:request|content) (?:is|involves?)\b[^.]{0,30}\b(?:illegal|harmful|dangerous|disallowed)\b/i,
  /\bi must decline\b/i,
  /\bi (?:can'?t|cannot|can not) fulfill (?:this|that|your) request\b/i,
  /\bi (?:can'?t|cannot|can not) provide (?:instructions|guidance|information)\b[^.]{0,60}\b(?:illegal|harmful|dangerous|weapon|drug|harm)/i,
];

/** True when a reply opens with a SAFETY refusal (as opposed
 * to the access-denial refusals looksLikeRefusal detects). A
 * safety refusal must never trigger the provider-shopping
 * refusal retry — the answer is no, everywhere. */
export function looksLikeSafetyRefusal(text: string): boolean {
  const head = text.slice(0, 500).toLowerCase();
  return SAFETY_REFUSAL_PATTERNS.some((pattern) => pattern.test(head));
}

export type SafetyFlagInput = {
  uid: string;
  chatId: string;
  prompt: string;
  category: SafetyCategory;
  signal: "prompt_pattern" | "model_refusal";
  model: string | null;
};

/** Write one flag for admin review. Best-effort by contract:
 * callers fire-and-forget; a failed write must never affect
 * the user's turn. */
export async function recordSafetyFlag(input: SafetyFlagInput): Promise<void> {
  const db = getFirebaseAdminFirestore();
  await db.collection("safetyFlags").add({
    uid: input.uid,
    chatId: input.chatId,
    prompt: input.prompt.slice(0, 500),
    category: input.category,
    signal: input.signal,
    model: input.model,
    status: "pending",
    ts: Date.now(),
    createdAt: Timestamp.now(),
  });
}

#!/usr/bin/env node
// Firebase configuration check (Phase 5) — `npm run verify:firebase`.
//
// Verifies, WITHOUT any real credentials or network calls:
//   1. The Firebase web config values are present and plausibly shaped.
//   2. The Firebase Admin values are present (values are never printed).
//   3. The rules/config files the project deploys exist and parse.
// Prints one line per check plus a pass/fail summary, and exits 1 when
// any check fails so it can gate a deploy checklist.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Load .env.local (then .env) for unset keys only, like Next.js does.
// Values are used for shape checks and are never printed.
for (const file of [".env.local", ".env"]) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] === undefined) {
      process.env[key] = raw.replace(/^["']|["']$/g, "");
    }
  }
}

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}
const env = (key) => process.env[key]?.trim() ?? "";

// --- Web config (public values; shape only) ---
check(
  "NEXT_PUBLIC_FIREBASE_API_KEY present",
  env("NEXT_PUBLIC_FIREBASE_API_KEY").length >= 20,
  "from the Firebase web app config",
);
check(
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN looks like a domain",
  /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(env("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN")),
);
check(
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID present",
  /^[a-z][a-z0-9-]{2,}$/.test(env("NEXT_PUBLIC_FIREBASE_PROJECT_ID")),
);
check(
  "NEXT_PUBLIC_FIREBASE_APP_ID present",
  env("NEXT_PUBLIC_FIREBASE_APP_ID").includes(":"),
  "expected the 1:<sender>:web:<hash> shape",
);
check(
  "NEXT_PUBLIC_FIREBASE_DATABASE_URL is an https Realtime Database URL",
  /^https:\/\/[a-z0-9.-]+(firebasedatabase\.app|firebaseio\.com)\/?$/i.test(
    env("NEXT_PUBLIC_FIREBASE_DATABASE_URL"),
  ),
  "required for presence and live chat streaming",
);

// --- Admin config (server secrets; presence only, never printed) ---
check(
  "FIREBASE_ADMIN_CLIENT_EMAIL present",
  /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env("FIREBASE_ADMIN_CLIENT_EMAIL")),
);
check(
  "FIREBASE_ADMIN_PRIVATE_KEY present and PEM-shaped",
  env("FIREBASE_ADMIN_PRIVATE_KEY").includes("BEGIN PRIVATE KEY"),
);
const adminProject = env("FIREBASE_ADMIN_PROJECT_ID") || env("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
check(
  "Firebase Admin project matches the web project",
  adminProject.length > 0 && adminProject === env("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
);

// --- Session secret (signs the session cookie) ---
check(
  "SESSION_SECRET present with at least 32 characters",
  env("SESSION_SECRET").length >= 32,
);

// --- Rules and project files ---
for (const file of ["firestore.rules", "database.rules.json", "storage.rules", "firebase.json"]) {
  check(`${file} exists`, existsSync(join(root, file)));
}
try {
  const rules = JSON.parse(readFileSync(join(root, "database.rules.json"), "utf8"));
  check(
    "database.rules.json parses and scopes chatStreams per user",
    typeof rules?.rules?.chatStreams === "object" && rules.rules.chatStreams !== null,
  );
} catch {
  check("database.rules.json parses and scopes chatStreams per user", false, "invalid JSON");
}
try {
  const firebaseJson = JSON.parse(readFileSync(join(root, "firebase.json"), "utf8"));
  check(
    "firebase.json wires firestore and database rules",
    Boolean(firebaseJson?.firestore?.rules) && Boolean(firebaseJson?.database?.rules),
  );
} catch {
  check("firebase.json wires firestore and database rules", false, "invalid JSON");
}
try {
  const firestoreRules = readFileSync(join(root, "firestore.rules"), "utf8");
  check(
    "firestore.rules denies client writes to chats/messages",
    firestoreRules.includes("match /users/{userId}/chats/{chatId}"),
  );
} catch {
  check("firestore.rules denies client writes to chats/messages", false, "unreadable");
}

const failed = results.filter((result) => !result.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed` +
    (failed.length ? ` — ${failed.length} FAILED` : " — Firebase configuration looks ready"),
);
process.exit(failed.length ? 1 : 0);

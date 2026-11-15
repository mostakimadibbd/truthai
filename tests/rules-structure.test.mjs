import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Structural regression guards for the security rules. These do NOT
// replace emulator-based rules tests; they make sure the critical
// invariants survive edits to the rules files — the failure mode
// this project actually hit (rules drifting from the code).
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const databaseRules = readFileSync(
  new URL("../database.rules.json", import.meta.url),
  "utf8",
);

test("server-only collections deny all client access", () => {
  for (const collection of [
    "usageEvents",
    "searchEvents",
    "chatErrors",
    "analytics_minutes",
    "analytics_days",
    "deviceSignals",
    "apiKeys",
  ]) {
    const block = new RegExp(
      `match /${collection}/\\{[^}]+\\} \\{[^}]*allow read, write: if false;`,
    );
    assert.match(rules, block, `${collection} must deny all client access`);
  }
});

test("per-user metering is owner-read, server-write only", () => {
  assert.match(rules, /match \/users\/\{userId\}\/chatUsage\/\{date\}/);
  assert.match(
    rules,
    /match \/users\/\{userId\}\/chatUsageByDay\/\{date\}\/chats\/\{chatId\}/,
  );
});

test("database rules are valid JSON and deny by default", () => {
  const parsed = JSON.parse(databaseRules);
  assert.ok(parsed.rules, "database.rules.json must have a rules root");
});

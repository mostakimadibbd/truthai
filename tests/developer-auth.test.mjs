import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { apiKeyAuthError } from "../lib/server/developer.ts";

// Revocation must be TOTAL (owner requirement, 2026-11-19): a
// revoked key — or a key whose account was disabled, unverified
// or deleted, or whose developer access was removed — reaches
// NOTHING in the API. These tests pin the outward error mapping
// and the structure that enforces it: one strict authenticate
// function used by every /api/v1 route, with no lighter check
// left anywhere.

test("apiKeyAuthError maps every refusal reason to its outward error", () => {
  assert.deepEqual(apiKeyAuthError("invalid_key"), {
    status: 401,
    code: "invalid_api_key",
    message:
      "Invalid or missing API key. Send your key as 'Authorization: Bearer xyro_sk_live_…'.",
  });
  assert.deepEqual(apiKeyAuthError("developer_access_revoked"), {
    status: 401,
    code: "invalid_api_key",
    message: "This API key is no longer active.",
  });
  assert.deepEqual(apiKeyAuthError("account_disabled"), {
    status: 403,
    code: "account_disabled",
    message: "This account is disabled.",
  });
  assert.deepEqual(apiKeyAuthError("account_suspended"), {
    status: 403,
    code: "account_suspended",
    message:
      "This account is temporarily suspended. API access resumes automatically when the suspension ends.",
  });
  assert.equal(apiKeyAuthError("email_not_verified").status, 403);
  assert.equal(apiKeyAuthError("email_not_verified").code, "email_not_verified");
  assert.deepEqual(apiKeyAuthError("account_unavailable"), {
    status: 503,
    code: "api_unavailable",
    message: "The API is temporarily unavailable.",
  });
});

test("authenticateApiKey enforces key, profile and account state", () => {
  const source = readFileSync(
    new URL("../lib/server/developer.ts", import.meta.url),
    "utf8",
  );
  // Revoked key records are refused.
  assert.match(source, /keySnapshot\.data\(\)\?\.revoked === true/);
  // Developer access must still exist.
  assert.match(source, /developer_access_revoked/);
  assert.match(source, /getDeveloperProfile\(uid\)/);
  // The owning account must exist, be enabled and be verified.
  assert.match(source, /user\.disabled/);
  assert.match(source, /account_disabled/);
  assert.match(source, /user\.emailVerified/);
  assert.match(source, /email_not_verified/);
  // A deleted account's key reads as invalid, not as a 503.
  assert.match(source, /auth\/user-not-found/);
  // A suspended account's keys are refused until the deadline
  // passes (timed suspension restores itself automatically).
  assert.match(source, /account_suspended/);
  assert.match(source, /suspendedUntil/);
});

test("the session gate refuses suspended accounts and clears expired ones", () => {
  const source = readFileSync(
    new URL("../app/api/auth/session/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /ACCOUNT_SUSPENDED/);
  assert.match(source, /suspendedUntil/);
  // Expired suspensions are wiped by the sign-in upsert.
  assert.match(source, /profile\.suspendedUntil = FieldValue\.delete\(\)/);
});

test("every /api/v1 route authenticates through the strict gate", () => {
  for (const route of [
    "../app/api/v1/chat/completions/route.ts",
    "../app/api/v1/models/route.ts",
  ]) {
    const source = readFileSync(new URL(route, import.meta.url), "utf8");
    assert.match(source, /authenticateApiKey\(/, route);
    assert.match(source, /apiKeyAuthError\(/, route);
  }
  // The models route previously authenticated the key alone;
  // the completions route must not keep a second, divergent
  // account check now that the gate is centralised.
  const completions = readFileSync(
    new URL("../app/api/v1/chat/completions/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(completions, /getFirebaseAdminAuth\(\)\.getUser/);
});

test("account self-deletion purges API keys and their lookups", () => {
  const source = readFileSync(
    new URL("../app/api/account/delete/route.ts", import.meta.url),
    "utf8",
  );
  // Top-level auth lookups are deleted per key…
  assert.match(source, /collection\("apiKeys"\)\.doc\(keyHash\)/);
  // …and the developer subcollections are part of the deletion.
  for (const sub of [
    "developerProfile",
    "apiUsage",
    "apiEvents",
    "apiModelUsage",
    "apiAccessPoints",
  ]) {
    assert.ok(source.includes(`"${sub}"`), sub);
  }
});

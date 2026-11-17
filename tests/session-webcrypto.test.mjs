import assert from "node:assert/strict";
import { test } from "node:test";

import { SignJWT } from "jose";

import { verifySessionTokenWebCrypto } from "../lib/server/session-webcrypto.ts";

const SECRET = "test-secret-that-is-at-least-32-characters-long";

async function mint({ expiresInSeconds = 3600, absExp } = {}) {
  return new SignJWT({
    sid: "session-123",
    absExp: absExp ?? Date.now() + 90 * 24 * 3600 * 1000,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("user-abc")
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(new TextEncoder().encode(SECRET));
}

test("Web Crypto verifier accepts jose-minted session tokens", async () => {
  assert.equal(await verifySessionTokenWebCrypto(await mint(), SECRET), true);
});

test("Web Crypto verifier rejects tampered, expired and wrong-key tokens", async () => {
  const token = await mint();
  const [header, payload, signature] = token.split(".");
  // Tampered payload (different subject, original signature).
  const forgedPayload = Buffer.from(
    JSON.stringify({ sub: "attacker", sid: "session-123" }),
  ).toString("base64url");
  assert.equal(
    await verifySessionTokenWebCrypto(`${header}.${forgedPayload}.${signature}`, SECRET),
    false,
  );
  // Wrong secret.
  assert.equal(await verifySessionTokenWebCrypto(token, "a-different-secret-that-is-long-enough"), false);
  // Expired exp.
  assert.equal(await verifySessionTokenWebCrypto(await mint({ expiresInSeconds: -60 }), SECRET), false);
  // Absolute expiry passed even with a live exp.
  assert.equal(
    await verifySessionTokenWebCrypto(await mint({ absExp: Date.now() - 1000 }), SECRET),
    false,
  );
  // Malformed.
  assert.equal(await verifySessionTokenWebCrypto("not-a-jwt", SECRET), false);
  assert.equal(await verifySessionTokenWebCrypto("", SECRET), false);
});

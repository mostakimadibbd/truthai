import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Image provenance (owner requirement, 2026-11-20): every
// generation saves a full record — generation ID, creator
// fingerprint (the same one hidden in the pixels), prompt,
// model, chat — so the admin panel can trace any picture back
// to its creator and the chat that produced it.

test("the generate route registers a full provenance record", () => {
  const source = readFileSync(
    new URL("../app/api/images/generate/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /collection\("imageGenerations"\)\.doc\(generationId\)/);
  for (const field of [
    "creatorFingerprint",
    "chatId",
    "assistantMessageId",
    "prompt",
    "model: usedModel",
    "provider: usedSource",
    "publicId",
    "createdAtMs",
  ]) {
    assert.ok(source.includes(field), field);
  }
  // The fingerprint stored is the one embedded in the picture.
  assert.match(source, /watermarkPayload\.split\(":"\)/);
});

test("imageGenerations is a server-only collection in the rules", () => {
  const rules = readFileSync(
    new URL("../firestore.rules", import.meta.url),
    "utf8",
  );
  assert.match(
    rules,
    /match \/imageGenerations\/\{generationId\} \{\s*allow read, write: if false;/,
  );
});

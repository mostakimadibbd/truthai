import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateCostUsd,
  modelAttemptOrder,
  perTokenToPerMillion,
  webModelAttemptOrder,
} from "../lib/server/models.ts";

test("per-token prices convert to per-million", () => {
  assert.equal(perTokenToPerMillion("0.0000005"), 0.5);
  assert.equal(perTokenToPerMillion("0"), 0);
  assert.equal(perTokenToPerMillion("not-a-price"), 0);
  assert.equal(perTokenToPerMillion(undefined), 0);
});

test("cost estimate multiplies prompt and completion rates", () => {
  const pricing = { promptPerMillion: 1, completionPerMillion: 2 };
  // 1M prompt tokens at $1 + 500k completion at $2 = $2.
  assert.equal(estimateCostUsd(pricing, 1_000_000, 500_000), 2);
  assert.equal(estimateCostUsd(pricing, 0, 0), 0);
});

test("model attempt order starts with the requested model and widens", () => {
  const order = modelAttemptOrder("some/free-model");
  assert.equal(order[0], "some/free-model");
  assert.ok(order.includes("openrouter/free"));
  assert.ok(order.length >= 3);
  // No duplicates.
  assert.equal(new Set(order).size, order.length);
});

test("webModelAttemptOrder puts curated models before the Auto router", () => {
  const order = webModelAttemptOrder("openrouter/free");
  assert.notEqual(order[0], "openrouter/free");
  assert.ok(order.includes("openrouter/free"));
  assert.equal(order[0], "nvidia/nemotron-3-ultra-550b-a55b:free");
});

test("freeOnlyAttempts keeps only the router and :free variants", async () => {
  const { freeOnlyAttempts } = await import("../lib/server/openrouter.ts");
  assert.deepEqual(
    freeOnlyAttempts(["openai/gpt-5", "openrouter/free", "nvidia/nemotron-3-ultra-550b-a55b:free", "anthropic/claude-sonnet-4"]),
    ["openrouter/free", "nvidia/nemotron-3-ultra-550b-a55b:free"],
  );
  assert.deepEqual(freeOnlyAttempts(["openai/gpt-5"]), ["openrouter/free"]);
});

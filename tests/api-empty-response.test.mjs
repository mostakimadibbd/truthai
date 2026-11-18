import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OpenRouterAttemptsExhausted,
  fetchChatCompletionWithFallback,
} from "../lib/server/openrouter.ts";

// Regression coverage for the developer-API complaint
// (2026-11-18): a free model answering HTTP 200 with an EMPTY
// completion was handed to API callers as a success — their
// apps showed "No response received from model" while their
// dashboard metered token cost. The chain now treats an empty
// completion as a failed attempt (via validateResponse) and
// falls through to the next model.

const realFetch = globalThis.fetch;

function completion(content) {
  return new Response(
    JSON.stringify({
      model: "fake",
      choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function usableContent(response) {
  const payload = await response.json().catch(() => null);
  if (!payload) return true;
  const content = payload.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim().length > 0;
}

function stubFetch(handler) {
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    return handler(body.model);
  };
}

const baseArgs = {
  apiKey: "test-key",
  messages: [{ role: "user", content: "Say hello" }],
  stream: false,
  referer: "https://example.test",
  title: "Test",
  connectTimeoutMs: 5_000,
};

test("an empty completion falls through to the next model", async () => {
  stubFetch((model) =>
    model.includes("model-a") ? completion("") : completion("Hello from B"),
  );
  try {
    const result = await fetchChatCompletionWithFallback({
      ...baseArgs,
      attempts: ["fake/model-a:free", "fake/model-b:free"],
      validateResponse: usableContent,
    });
    assert.match(result.model, /model-b/);
    const payload = await result.response.json();
    assert.equal(payload.choices[0].message.content, "Hello from B");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("when every model answers empty, the chain reports EMPTY_COMPLETION", async () => {
  stubFetch(() => completion("   "));
  try {
    await assert.rejects(
      fetchChatCompletionWithFallback({
        ...baseArgs,
        attempts: ["fake/model-a:free", "fake/model-b:free"],
        validateResponse: usableContent,
      }),
      (error) => {
        assert.ok(error instanceof OpenRouterAttemptsExhausted);
        assert.equal(error.lastErrorBody, "EMPTY_COMPLETION");
        return true;
      },
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("without a validator, the first 200 still wins (chat path unchanged)", async () => {
  stubFetch(() => completion(""));
  try {
    const result = await fetchChatCompletionWithFallback({
      ...baseArgs,
      attempts: ["fake/model-a:free", "fake/model-b:free"],
    });
    assert.match(result.model, /model-a/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

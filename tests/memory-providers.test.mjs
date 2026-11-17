import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractMemories,
  liveVisibleText,
  memorySystemBlock,
  normalizeMemoryKey,
  sanitizeMemoryText,
} from "../lib/server/memory.ts";
import {
  buildAttemptTargets,
  crossProviderTargets,
} from "../lib/server/openrouter.ts";
import { modelAttemptOrder, webModelAttemptOrder } from "../lib/server/models.ts";

test("extractMemories strips markers and collects facts", () => {
  const { cleanText, memories } = extractMemories(
    "Dhaka is a great base.\n[[memory: The user lives in Dhaka]]\n[[memory: User is building a startup]]",
  );
  assert.equal(cleanText, "Dhaka is a great base.");
  assert.deepEqual(memories, ["The user lives in Dhaka", "User is building a startup"]);
});

test("extractMemories tolerates replies without markers", () => {
  const { cleanText, memories } = extractMemories("Plain answer.");
  assert.equal(cleanText, "Plain answer.");
  assert.deepEqual(memories, []);
});

test("liveVisibleText holds back an unterminated marker tail", () => {
  assert.equal(liveVisibleText("Hello [[memory: The user"), "Hello");
  assert.equal(liveVisibleText("Hello [[memory: x]] world"), "Hello  world");
  assert.equal(liveVisibleText("No markers here"), "No markers here");
});

test("sanitize + normalize make dedupe work", () => {
  assert.equal(sanitizeMemoryText("  User   likes   tea  "), "User likes tea");
  assert.equal(normalizeMemoryKey("User likes Tea!"), normalizeMemoryKey("user likes tea"));
  assert.equal(sanitizeMemoryText("[[nested]]"), "nested");
});

test("memorySystemBlock lists facts and the save protocol", () => {
  const block = memorySystemBlock(["User lives in Dhaka"]);
  assert.match(block, /- User lives in Dhaka/);
  assert.match(block, /\[\[memory:/);
});

test("crossProviderTargets is empty without keys and ordered with them", () => {
  assert.deepEqual(crossProviderTargets({}), []);
  const targets = crossProviderTargets({
    GROQ_API_KEY: "gsk_test",
    GEMINI_API_KEY: "gem_test",
  });
  // Gemini pool comes before Groq in the chain.
  assert.equal(targets[0].provider, "gemini");
  assert.equal(targets[0].label, "gemini/gemini-2.5-flash");
  assert.ok(targets.some((t) => t.provider === "groq" && t.model === "openai/gpt-oss-120b"));
  assert.ok(targets.every((t) => typeof t.apiKey === "string" && t.apiKey.length > 0));
});

test("buildAttemptTargets keeps OpenRouter first, providers after", () => {
  const targets = buildAttemptTargets(["openrouter/free"], "or_key", {
    GROQ_API_KEY: "gsk_test",
  });
  assert.equal(targets[0].provider, "openrouter");
  assert.equal(targets[0].label, "openrouter/free");
  assert.equal(targets[1].provider, "groq");
});

test("attempt orders use the refreshed live free catalogue", () => {
  const order = modelAttemptOrder("openrouter/free");
  assert.equal(order[0], "openrouter/free");
  assert.ok(order.includes("nvidia/nemotron-3-ultra-550b-a55b:free"));
  assert.ok(!order.some((id) => id.includes("llama-3.3-70b")));
  const web = webModelAttemptOrder("openrouter/free");
  assert.equal(web.at(-1), "openrouter/free");
  assert.equal(web[0], "nvidia/nemotron-3-ultra-550b-a55b:free");
});

test("vision turns only target models that can see images", async () => {
  const { crossProviderTargets: cpt, messagesHaveImages } = await import("../lib/server/openrouter.ts");
  const env = { GEMINI_API_KEY: "g", GROQ_API_KEY: "q", REQUESTY_API_KEY: "r", SAMBANOVA_API_KEY: "s", NVIDIA_API_KEY: "n" };
  const vision = cpt(env, true);
  assert.ok(vision.every((t) => t.provider === "gemini" || (t.provider === "requesty" && t.model === "google/gemma-4-31b-it")));
  assert.equal(vision.filter((t) => t.provider === "gemini").length, 2);
  assert.equal(vision.length, 3);
  assert.equal(messagesHaveImages([{ role: "user", content: "hi" }]), false);
  assert.equal(messagesHaveImages([{ role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "https://x/y.jpg" } }] }]), true);
});

test("looksLikeRefusal catches access-denial openers only", async () => {
  const { looksLikeRefusal } = await import("../lib/server/openrouter.ts");
  assert.equal(looksLikeRefusal("I can't browse the web, but here's what I know."), true);
  assert.equal(looksLikeRefusal("As an AI language model, I don't have access to real-time data."), true);
  assert.equal(looksLikeRefusal("Here is a summary of the article you shared."), false);
  assert.equal(looksLikeRefusal("I can't recommend a specific brand, but these three are popular."), false);
});

test("buildAttemptTargets providersFirst puts Groq ahead of OpenRouter", async () => {
  const { buildAttemptTargets: bat } = await import("../lib/server/openrouter.ts");
  const targets = bat(["openrouter/free"], "or_key", { GROQ_API_KEY: "g" }, false, true);
  assert.equal(targets[0].provider, "groq");
  assert.ok(targets.some((t) => t.provider === "openrouter"));
  const normal = bat(["openrouter/free"], "or_key", { GROQ_API_KEY: "g" });
  assert.equal(normal[0].provider, "openrouter");
});

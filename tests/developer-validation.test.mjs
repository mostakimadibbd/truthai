import { test } from "node:test";
import assert from "node:assert/strict";
import { validateActivationInput } from "../lib/server/developer.ts";

const validBody = {
  projectName: "Study Buddy",
  useCase: "chatbot",
  builderType: "individual",
  language: "python",
  callEnvironment: "server-backend",
  expectedUsage: "testing",
  termsAccepted: true,
};

test("a complete preset activation validates", () => {
  const result = validateActivationInput(validBody);
  assert.equal(result.ok, true);
  assert.equal(result.value.projectName, "Study Buddy");
  assert.equal(result.value.heardFrom, null);
  assert.equal(result.value.website, null);
});

test("'other' answers are stored as the written text", () => {
  const result = validateActivationInput({
    ...validBody,
    useCase: "other",
    useCaseCustom: "A tutoring bot for my school",
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.useCase, "A tutoring bot for my school");
});

test("'other' without a written answer is rejected", () => {
  const result = validateActivationInput({ ...validBody, language: "other" });
  assert.equal(result.ok, false);
  assert.match(result.message, /Primary language/);
});

test("missing and malformed fields are rejected with guidance", () => {
  assert.equal(validateActivationInput({}).ok, false);
  assert.equal(
    validateActivationInput({ ...validBody, termsAccepted: false }).ok,
    false,
  );
  assert.equal(
    validateActivationInput({ ...validBody, projectName: "x" }).ok,
    false,
  );
  assert.equal(
    validateActivationInput({ ...validBody, expectedUsage: "millions" }).ok,
    false,
  );
  assert.equal(
    validateActivationInput({ ...validBody, website: "not a url" }).ok,
    false,
  );
});

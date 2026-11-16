import { test } from "node:test";
import assert from "node:assert/strict";
import { isAdminEmail, isAdminRecord } from "../lib/server/admin.ts";

test("database admin flag is the source of truth", () => {
  assert.equal(isAdminRecord({ admin: true }), true);
  assert.equal(isAdminRecord({ admin: false }), false);
  assert.equal(isAdminRecord({}), false);
  assert.equal(isAdminRecord({ admin: "true" }), false); // string is not enough
  assert.equal(isAdminRecord({ admin: 1 }), false);
  assert.equal(isAdminRecord(null), false);
  assert.equal(isAdminRecord(undefined), false);
});

test("bootstrap allowlist still recognises the owner email", () => {
  assert.equal(isAdminEmail("mostakimbdyt@gmail.com"), true);
  assert.equal(isAdminEmail("MostakimBdyt@Gmail.com"), true); // case-insensitive
  assert.equal(isAdminEmail("someone-else@example.com"), false);
  assert.equal(isAdminEmail(null), false);
  assert.equal(isAdminEmail(undefined), false);
  assert.equal(isAdminEmail(""), false);
});

test("ADMIN_EMAILS env extends the allowlist", () => {
  const previous = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "Second@Example.com , third@example.com";
  try {
    assert.equal(isAdminEmail("second@example.com"), true);
    assert.equal(isAdminEmail("third@example.com"), true);
    assert.equal(isAdminEmail("fourth@example.com"), false);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previous;
  }
});

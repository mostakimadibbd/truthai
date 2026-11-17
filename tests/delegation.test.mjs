import assert from "node:assert/strict";
import { test } from "node:test";

import { mintDelegationAssertion } from "../lib/server/delegation.ts";

// Interop vector shared with the Python suite: the backend's
// verify_delegation_assertion must accept exactly this string
// for this token/uid at this time. If either side's format
// drifts, one of the two suites goes red.
test("delegation assertion matches the shared interop vector", () => {
  const assertion = mintDelegationAssertion(
    "user-123",
    "test-service-token-0123456789",
    1_700_000_000,
  );
  assert.equal(
    assertion,
    "eyJ1aWQiOiJ1c2VyLTEyMyIsImV4cCI6MTcwMDAwMDM2MH0.985baa291a91627338877648e88fe8e791d7de37489272b40607cd58a70e6d54",
  );
});

test("delegation assertion binds the uid and expiry", () => {
  const a = mintDelegationAssertion("user-a", "tok", 1_700_000_000);
  const b = mintDelegationAssertion("user-b", "tok", 1_700_000_000);
  assert.notEqual(a, b);
  const [payload] = a.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(decoded.uid, "user-a");
  assert.equal(decoded.exp, 1_700_000_000 + 360);
});

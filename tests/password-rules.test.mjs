import { test } from "node:test";
import assert from "node:assert/strict";
import {
  passwordMeetsRules,
  passwordRuleResults,
  passwordStrength,
  passwordUnmetMessage,
} from "../lib/password-rules.ts";

test("all four rules are mandatory", () => {
  assert.equal(passwordMeetsRules("GoodPass!x"), true);
  assert.equal(passwordMeetsRules("short"), false); // length
  assert.equal(passwordMeetsRules("alllowercase!"), false); // no uppercase
  assert.equal(passwordMeetsRules("ALLUPPERCASE!"), false); // no lowercase
  assert.equal(passwordMeetsRules("NoSymbolHere"), false); // no symbol
  assert.equal(passwordMeetsRules("TenChars!A"), true); // exactly 10
});

test("rule results report each rule independently", () => {
  const results = Object.fromEntries(
    passwordRuleResults("abc").map((rule) => [rule.id, rule.met]),
  );
  assert.deepEqual(results, {
    length: false,
    lowercase: true,
    uppercase: false,
    symbol: false,
  });
});

test("strength meter labels", () => {
  assert.equal(passwordStrength("").label, "Weak");
  assert.equal(passwordStrength("GoodPass!x").label, "Good");
  assert.equal(passwordStrength("EvenBetterPass!14").label, "Strong");
  assert.equal(passwordStrength("GoodPass!x").score, 3);
  assert.equal(passwordStrength("EvenBetterPass!14").score, 4);
});

test("unmet message names exactly what is missing", () => {
  assert.equal(passwordUnmetMessage("GoodPass!x"), null);
  const message = passwordUnmetMessage("abc");
  assert.match(message, /at least 10 characters/);
  assert.match(message, /an uppercase letter/);
  assert.match(message, /a symbol/);
  assert.doesNotMatch(message, /lowercase/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The main app must carry NO admin surface: administration lives
// in the separate admin-panel app + the backend service's admin
// API. These structural checks keep it that way.
test("the in-app admin page is a 404 stub", () => {
  const page = readFileSync(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
  assert.match(page, /notFound\(\)/);
  assert.doesNotMatch(page, /AdminShell/);
});

test("the in-app admin APIs are 404 stubs", () => {
  for (const path of ["../app/api/admin/overview/route.ts", "../app/api/admin/users/route.ts"]) {
    const route = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(route, /404/);
    assert.doesNotMatch(route, /authenticateAdmin|getAnalytics|listUsers/);
  }
});

test("settings contains no admin link", () => {
  const shell = readFileSync(
    new URL("../app/settings/settings-shell.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(shell, /\/admin/);
});

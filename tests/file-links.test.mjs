import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ownFileAccessUrl } from "../lib/server/cloudinary.ts";

// Owner requirement (2026-11-19): a browser must NEVER receive
// a Cloudinary link for a private file — previews and clicks
// stay on our own domain. These tests pin the URL shape and
// every client-bound accessUrl source.

test("ownFileAccessUrl only ever returns our own paths", () => {
  assert.equal(
    ownFileAccessUrl("xyro_LngeIY3_x_y.pdf", "b00848df-1111-4111-8111-111111111111"),
    "/api/files/b00848df-1111-4111-8111-111111111111",
  );
  assert.equal(
    ownFileAccessUrl("blob:abcdefghijklmnop", "b00848df-1111-4111-8111-111111111111"),
    "/api/media/abcdefghijklmnop",
  );
  assert.ok(!ownFileAccessUrl("xyro/x/y", "id").includes("cloudinary"));
});

test("every route that hands an accessUrl to a client uses our link", () => {
  for (const route of [
    "../app/api/uploads/access/route.ts",
    "../app/api/uploads/confirm/route.ts",
    "../app/api/uploads/direct/route.ts",
    "../app/api/images/generate/route.ts",
  ]) {
    const source = readFileSync(new URL(route, import.meta.url), "utf8");
    assert.match(source, /ownFileAccessUrl\(/, route);
  }
  // The access route must not mint Cloudinary URLs at all; the
  // confirm route keeps exactly one server-side use (the
  // content sample it fetches itself during verification).
  const access = readFileSync(
    new URL("../app/api/uploads/access/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(access, /getCloudinaryPrivateDownloadUrl/);
});

test("the file proxy re-checks session and ownership before streaming", () => {
  const source = readFileSync(
    new URL("../app/api/files/[assetId]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /requireSession\(request\)/);
  assert.match(source, /\.doc\(session\.uid\)/);
  assert.match(source, /data\.status !== "ready"/);
  // The Cloudinary URL is fetched server-side only.
  assert.match(source, /getCloudinaryPrivateDownloadUrl\(/);
  assert.match(source, /await fetch\(upstreamUrl/);
});

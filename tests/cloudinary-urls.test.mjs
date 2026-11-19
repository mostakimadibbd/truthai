import assert from "node:assert/strict";
import { test } from "node:test";

// Dummy offline credentials: URL generation and signing are
// local operations, so these never leave the machine.
process.env.CLOUDINARY_CLOUD_NAME = "testcloud";
process.env.CLOUDINARY_API_KEY = "123456789";
process.env.CLOUDINARY_API_SECRET = "test-secret";

const { getCloudinaryPrivateDownloadUrl } = await import(
  "../lib/server/cloudinary.ts"
);

test("raw assets use the API download endpoint, not the signed delivery URL", () => {
  // Regression (2026-11-19): Cloudinary answers the signed
  // res.cloudinary.com delivery URL with 401 for RAW
  // authenticated assets (PDF/TXT/MD/CSV) while the same shape
  // works for images. That broke document chat end to end —
  // the confirm sample and the chat route's download both
  // 401'd, so files never reached the model. Raw files must
  // go through private_download_url, which returns the exact
  // bytes (verified live against the real account).
  const url = getCloudinaryPrivateDownloadUrl(
    "xyro_uid_chat_asset.pdf",
    "pdf",
    "raw",
  );
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "api.cloudinary.com");
  assert.equal(parsed.pathname, "/v1_1/testcloud/raw/download");
  assert.ok(parsed.searchParams.get("public_id")?.endsWith(".pdf"));
  assert.ok(parsed.searchParams.get("signature"));
  assert.equal(parsed.searchParams.get("api_key"), "123456789");
});

test("image assets keep the signed authenticated delivery URL", () => {
  // Images render inline in <img> tags, which the API download
  // endpoint's Content-Disposition: attachment prevents — so
  // images stay on the signed delivery URL (verified live:
  // 200 with the real bytes).
  const url = getCloudinaryPrivateDownloadUrl(
    "xyro/generated/uid/gen-id",
    "png",
    "image",
  );
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "res.cloudinary.com");
  assert.match(
    parsed.pathname,
    /^\/testcloud\/image\/authenticated\/s--[^/]+--\/(v\d+\/)?xyro\/generated\/uid\/gen-id\.png$/,
  );
});

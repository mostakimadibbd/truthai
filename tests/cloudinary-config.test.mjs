import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cloudinaryConfigCandidates,
  parseCloudinaryUrl,
} from "../lib/server/cloudinary.ts";

test("parseCloudinaryUrl accepts the combined URL and rejects junk", () => {
  assert.deepEqual(
    parseCloudinaryUrl("cloudinary://123456789012345:my-secret@my-cloud"),
    { cloudName: "my-cloud", apiKey: "123456789012345", apiSecret: "my-secret" },
  );
  // URL-encoded characters in the secret survive decoding.
  assert.equal(
    parseCloudinaryUrl("cloudinary://key:p%40ss%2Fword@cloud")?.apiSecret,
    "p@ss/word",
  );
  assert.equal(parseCloudinaryUrl("https://example.com/nope"), null);
  assert.equal(parseCloudinaryUrl("cloudinary://onlykey@cloud"), null);
  assert.equal(parseCloudinaryUrl(""), null);
  assert.equal(parseCloudinaryUrl(undefined), null);
  assert.equal(parseCloudinaryUrl("not a url"), null);
});

test("candidates: variables first, URL as a distinct backup", () => {
  const trio = { cloudName: "cloud-a", apiKey: "key-a", apiSecret: "secret-a" };
  // URL with the SAME credentials adds no second candidate.
  assert.deepEqual(
    cloudinaryConfigCandidates({ ...trio, url: "cloudinary://key-a:secret-a@cloud-a" }),
    [trio],
  );
  // URL with DIFFERENT credentials becomes the fallback candidate.
  assert.deepEqual(
    cloudinaryConfigCandidates({ ...trio, url: "cloudinary://key-b:secret-b@cloud-b" }),
    [trio, { cloudName: "cloud-b", apiKey: "key-b", apiSecret: "secret-b" }],
  );
  // URL alone works when the variables are missing.
  assert.deepEqual(
    cloudinaryConfigCandidates({ url: "cloudinary://key-b:secret-b@cloud-b" }),
    [{ cloudName: "cloud-b", apiKey: "key-b", apiSecret: "secret-b" }],
  );
  // Nothing configured: no candidates.
  assert.deepEqual(cloudinaryConfigCandidates({}), []);
});

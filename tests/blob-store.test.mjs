import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BLOB_CHUNK_BYTES,
  chunkBuffer,
  joinChunks,
} from "../lib/server/blob-store.ts";
import {
  blobIdFromPublicId,
  getCloudinaryPrivateDownloadUrl,
  isBlobPublicId,
} from "../lib/server/cloudinary.ts";

test("chunkBuffer/joinChunks round-trip any size", () => {
  for (const size of [0, 1, 100, BLOB_CHUNK_BYTES, BLOB_CHUNK_BYTES + 1, 2_500_000]) {
    const original = Buffer.alloc(size);
    for (let i = 0; i < size; i += 1) original[i] = i % 251;
    const chunks = chunkBuffer(original);
    assert.ok(chunks.every((chunk) => chunk.length <= BLOB_CHUNK_BYTES));
    assert.equal(joinChunks(chunks).equals(original), true, `size ${size}`);
  }
  // An empty file still stores exactly one (empty) chunk so the
  // metadata's chunk count is never zero.
  assert.equal(chunkBuffer(Buffer.alloc(0)).length, 1);
});

test("blob: publicIds route to the media endpoint", () => {
  assert.equal(isBlobPublicId("blob:abc123"), true);
  assert.equal(isBlobPublicId("xyro/user/chat/file"), false);
  assert.equal(blobIdFromPublicId("blob:abc123"), "abc123");
  assert.equal(
    getCloudinaryPrivateDownloadUrl("blob:abc123", "png", "image"),
    "/api/media/abc123",
  );
});

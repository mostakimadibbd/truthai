import assert from "node:assert/strict";
import { test } from "node:test";
import { PNG } from "pngjs";

import {
  buildWatermarkPayload,
  embedWatermark,
  extractWatermark,
} from "../lib/server/watermark.ts";

// Deterministic textured PNG (varied pixel values, like a real
// photo) so the LSB plane is exercised honestly.
function makePng(width, height) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      png.data[i] = (x * 7 + y * 3) % 256;
      png.data[i + 1] = (x * 5 + y * 11) % 256;
      png.data[i + 2] = (x * 13 + y * 17) % 256;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

test("watermark payload carries the TruthAI brand", () => {
  const payload = buildWatermarkPayload(
    "b00848df-495d-4d75-b573-2c9ffa30b156",
    "some-user-id",
  );
  assert.match(payload, /^truthai:b00848df-495d-4d75-b573-2c9ffa30b156:[0-9a-f]{16}$/);
});

test("embed then extract round-trips the payload", async () => {
  const payload = buildWatermarkPayload("gen-123", "user-abc");
  const marked = await embedWatermark(makePng(300, 300), payload);
  assert.equal(extractWatermark(marked), payload);
});

test("a destroyed first tile still verifies from a later tile copy", async () => {
  const payload = buildWatermarkPayload("gen-tiles", "user-abc");
  const marked = await embedWatermark(makePng(768, 768), payload);
  // Wipe the LSBs of the whole first 256x256 tile (the origin
  // copy) — the tiled copies elsewhere must still verify.
  const png = PNG.sync.read(marked);
  for (let y = 0; y < 256; y += 1) {
    for (let x = 0; x < 256; x += 1) {
      const i = (y * png.width + x) * 4;
      png.data[i] &= 0xfe;
      png.data[i + 1] &= 0xfe;
      png.data[i + 2] &= 0xfe;
    }
  }
  assert.equal(extractWatermark(PNG.sync.write(png)), payload);
});

test("an unwatermarked image yields no payload", () => {
  assert.equal(extractWatermark(makePng(300, 300)), null);
});

test("non-PNG input yields no payload", () => {
  assert.equal(extractWatermark(Buffer.from("not an image")), null);
});

// Verify the invisible watermark in a Xyro AI generated image.
//
//   node scripts/verify-watermark.mjs <image.png>
//
// Prints the embedded payload ("truthai:<generationId>:<uid-hash>")
// and exits 0 when a valid watermark is found; prints "No Xyro AI
// watermark found" and exits 1 otherwise. This is an INDEPENDENT
// implementation of the frame format in lib/server/watermark.ts
// (magic "XYRO", version 1, uint16 length, CRC-32), so it verifies
// the format itself, not just the library's self-consistency.
//
// A missing watermark never proves an image is human-made: editing,
// cropping, JPEG re-encoding or screenshots can destroy LSB data.

import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

const MAGIC = [0x58, 0x59, 0x52, 0x4f];
const HEADER_BYTES = 7;
const CRC_BYTES = 4;
const MAX_PAYLOAD_BYTES = 512;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readBytes(data, startBit, byteCount) {
  const out = Buffer.alloc(byteCount);
  const endBit = startBit + byteCount * 8;
  let bitIndex = 0;
  outer: for (let i = 0; i < data.length; i += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      if (bitIndex >= endBit) break outer;
      if (bitIndex >= startBit) {
        const bytePos = (bitIndex - startBit) >> 3;
        out[bytePos] = (out[bytePos] << 1) | (data[i + channel] & 1);
      }
      bitIndex += 1;
    }
  }
  return bitIndex >= endBit ? out : null;
}

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/verify-watermark.mjs <image.png>");
  process.exit(2);
}

let png;
try {
  png = PNG.sync.read(readFileSync(path));
} catch {
  console.log("No TruthAI watermark found (not a readable PNG).");
  process.exit(1);
}

const header = readBytes(png.data, 0, HEADER_BYTES);
const valid =
  header &&
  MAGIC.every((byte, index) => header[index] === byte) &&
  header[4] === 1;
if (!valid) {
  console.log("No TruthAI watermark found.");
  process.exit(1);
}
const length = header.readUInt16BE(5);
if (length === 0 || length > MAX_PAYLOAD_BYTES) {
  console.log("No TruthAI watermark found.");
  process.exit(1);
}
const rest = readBytes(png.data, HEADER_BYTES * 8, length + CRC_BYTES);
if (!rest || crc32(rest.subarray(0, length)) !== rest.readUInt32BE(length)) {
  console.log("No TruthAI watermark found.");
  process.exit(1);
}
console.log(`Watermark found: ${rest.subarray(0, length).toString("utf8")}`);
process.exit(0);

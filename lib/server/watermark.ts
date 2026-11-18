// Invisible watermark for AI-generated images (Phase 7,
// upgraded 2026-11-18 at the owner's direction).
//
// Every picture TruthAI creates passes through here before it
// is stored: a short provenance payload — "truthai:<generation
// Id>:<uid-hash>" — is embedded in the least significant bits
// of the image's RGB channels (LSB steganography), TILED
// across the whole picture: the full frame is repeated at
// every 256×256 pixel tile origin, microscopically, so the
// mark survives local damage (a blurred corner, a sticker, a
// covered region) as long as any one tile survives intact.
// Changing one bit per channel shifts a colour value by at
// most 1/255, which is imperceptible; dimensions and format
// are unchanged (output is always PNG). The matching
// extractor below, the scripts/verify-watermark.mjs CLI and
// the public /verify-image page (which runs the same scan in
// the visitor's browser, no account needed) can read the
// payload back from the stored PNG. Like all watermarking
// this is a provenance SIGNAL, not proof: heavy editing,
// cropping, re-encoding to JPEG or screenshots can destroy
// it, and a missing payload never proves an image is
// human-made (see the XyroAIDetect public page).
//
// Implementation is dependency-light and pure JS:
//  - PNG: decoded/encoded with pngjs.
//  - JPEG: decoded with jpeg-js, re-encoded as PNG via pngjs.
//  - WebP: no pure-JS decoder exists; conversion uses sharp,
//    which is a declared dependency (statically imported below
//    and externalised via serverExternalPackages). Next.js ships
//    it for image optimisation), otherwise a clear error is thrown
//    and the generation fails honestly instead of storing an
//    unwatermarked image.

import { createHash } from "node:crypto";
import * as jpeg from "jpeg-js";
import { PNG } from "pngjs";
import sharp from "sharp";
import { sniffImageType } from "@/lib/server/image-sniff";

const MAGIC = [0x58, 0x59, 0x52, 0x4f]; // "XYRO"
const VERSION = 1;
const HEADER_BYTES = MAGIC.length + 1 + 2; // magic + version + uint16 length
const CRC_BYTES = 4;
const MAX_PAYLOAD_BYTES = 512;

type Pixels = { width: number; height: number; data: Buffer };

/** The payload embedded in every generated image. */
export function buildWatermarkPayload(generationId: string, uid: string): string {
  const uidHash = createHash("sha256").update(uid).digest("hex").slice(0, 16);
  return `truthai:${generationId}:${uidHash}`;
}

// CRC-32 (IEEE) over the payload bytes, so random pixel noise or a
// tampered image cannot produce a plausible-looking false payload.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngToPixels(buffer: Buffer): Pixels {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: Buffer.from(png.data) };
}

function pixelsToPng(pixels: Pixels): Buffer {
  const png = new PNG({ width: pixels.width, height: pixels.height });
  pixels.data.copy(png.data);
  return PNG.sync.write(png);
}

function jpegToPixels(buffer: Buffer): Pixels {
  const decoded = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
  if (!decoded || !decoded.width || !decoded.height || !decoded.data) {
    throw new Error("The generated JPEG image couldn’t be decoded.");
  }
  return {
    width: decoded.width,
    height: decoded.height,
    data: Buffer.from(decoded.data),
  };
}

async function webpToPixels(buffer: Buffer): Promise<Pixels> {
  try {
    // sharp is a static import (declared in types/sharp.d.ts and
    // externalised via serverExternalPackages in next.config.ts,
    // so it loads from the runtime's node_modules — Next.js ships
    // it for image optimisation). A failure here still degrades
    // to the honest error below.
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 4) {
      throw new Error("Unexpected channel count.");
    }
    return { width: info.width, height: info.height, data: Buffer.from(data) };
  } catch {
    throw new Error(
      "The model returned a WebP image, which this deployment can’t watermark. Please try again.",
    );
  }
}

/** Decode a model-returned image (PNG or JPEG; WebP best-effort) to pixels. */
export async function decodeImageToPixels(buffer: Buffer): Promise<Pixels> {
  const sniffed = sniffImageType(buffer);
  if (sniffed === "png") return pngToPixels(buffer);
  if (sniffed === "jpeg") return jpegToPixels(buffer);
  if (sniffed === "webp") return webpToPixels(buffer);
  throw new Error("The model returned an image in a format Xyro AI can’t process.");
}

function capacityBits(pixels: Pixels): number {
  // One bit per RGB channel per pixel; alpha is never touched.
  return pixels.width * pixels.height * 3;
}

// The frame repeats at every TILE_PIXELS × TILE_PIXELS tile
// origin. Bit addressing is direct: bit b lives in pixel
// floor(b / 3), channel b % 3 (alpha skipped), so a frame can
// be written or read at any bit offset in O(frame) time.
export const WATERMARK_TILE_PIXELS = 256;

function tileStartBits(pixels: Pixels): number[] {
  const starts: number[] = [];
  for (let ty = 0; ty < pixels.height; ty += WATERMARK_TILE_PIXELS) {
    for (let tx = 0; tx < pixels.width; tx += WATERMARK_TILE_PIXELS) {
      starts.push((ty * pixels.width + tx) * 3);
    }
  }
  return starts;
}

function embedFrameAt(pixels: Pixels, frame: Buffer, startBit: number): void {
  const totalBits = frame.length * 8;
  for (let i = 0; i < totalBits; i += 1) {
    const bit = (frame[i >> 3] >> (7 - (i & 7))) & 1;
    const absolute = startBit + i;
    const pixel = Math.floor(absolute / 3);
    const channel = absolute % 3;
    const offset = pixel * 4 + channel;
    pixels.data[offset] = (pixels.data[offset] & 0xfe) | bit;
  }
}

function readBytesAt(pixels: Pixels, startBit: number, byteCount: number): Buffer | null {
  if (startBit + byteCount * 8 > capacityBits(pixels)) return null;
  const out = Buffer.alloc(byteCount);
  for (let i = 0; i < byteCount * 8; i += 1) {
    const absolute = startBit + i;
    const pixel = Math.floor(absolute / 3);
    const channel = absolute % 3;
    const bit = pixels.data[pixel * 4 + channel] & 1;
    out[i >> 3] = (out[i >> 3] << 1) | bit;
  }
  return out;
}

/**
 * Embed `payload` into the image and return a watermarked PNG.
 * The output has identical dimensions to the input; each RGB value
 * differs by at most 1.
 */
export async function embedWatermark(image: Buffer, payload: string): Promise<Buffer> {
  const payloadBytes = Buffer.from(payload, "utf8");
  if (payloadBytes.length === 0 || payloadBytes.length > MAX_PAYLOAD_BYTES) {
    throw new Error("The watermark payload is invalid.");
  }
  const pixels = await decodeImageToPixels(image);
  const frame = Buffer.alloc(HEADER_BYTES + payloadBytes.length + CRC_BYTES);
  frame.set(MAGIC, 0);
  frame[4] = VERSION;
  frame.writeUInt16BE(payloadBytes.length, 5);
  payloadBytes.copy(frame, HEADER_BYTES);
  frame.writeUInt32BE(crc32(payloadBytes), HEADER_BYTES + payloadBytes.length);
  if (frame.length * 8 > capacityBits(pixels)) {
    throw new Error("The generated image is too small to watermark.");
  }
  // Tile the frame across the whole picture (see the header
  // comment): every tile that can hold the full frame gets a
  // complete copy, starting with the origin tile at bit 0.
  for (const startBit of tileStartBits(pixels)) {
    if (startBit + frame.length * 8 > capacityBits(pixels)) continue;
    embedFrameAt(pixels, frame, startBit);
  }
  return pixelsToPng(pixels);
}

/**
 * Read a watermark payload back from a PNG buffer. Returns null for
 * unwatermarked, tampered, corrupt or non-PNG input — never throws.
 * (Extraction is only defined for PNG: JPEG re-encoding destroys
 * LSB data by design.)
 */
export function extractWatermark(pngBuffer: Buffer): string | null {
  try {
    if (sniffImageType(pngBuffer) !== "png") return null;
    const pixels = pngToPixels(pngBuffer);
    // Scan every tile origin (bit 0 first): any intact copy of
    // the frame verifies, so local damage to one region of the
    // picture cannot erase the mark everywhere. Frames written
    // before tiling existed live only at bit 0 and are found by
    // the same scan.
    for (const startBit of tileStartBits(pixels)) {
      const header = readBytesAt(pixels, startBit, HEADER_BYTES);
      if (!header) continue;
      let magicOk = true;
      for (let i = 0; i < MAGIC.length; i += 1) {
        if (header[i] !== MAGIC[i]) {
          magicOk = false;
          break;
        }
      }
      if (!magicOk || header[4] !== VERSION) continue;
      const length = header.readUInt16BE(5);
      if (length === 0 || length > MAX_PAYLOAD_BYTES) continue;
      const rest = readBytesAt(
        pixels,
        startBit + HEADER_BYTES * 8,
        length + CRC_BYTES,
      );
      if (!rest) continue;
      const payloadBytes = rest.subarray(0, length);
      const storedCrc = rest.readUInt32BE(length);
      if (crc32(Buffer.from(payloadBytes)) !== storedCrc) continue;
      return new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes);
    }
    return null;
  } catch {
    return null;
  }
}

"use client";

import { useCallback, useRef, useState } from "react";

// Public TruthAI image verifier (owner request, 2026-11-18):
// anyone — account or not — can drop in a picture and check
// whether TruthAI created it. Every image TruthAI generates
// carries an invisible pixel-level watermark (see
// lib/server/watermark.ts): a framed payload tiled across the
// picture in the least significant bits of its pixels. This
// page runs the SAME extraction entirely in the visitor's
// browser — the image never leaves their device, nothing is
// uploaded, and no sign-in is needed. A found mark is a
// provenance signal, not proof; a missing mark never proves
// an image is human-made (editing, screenshots and JPEG
// re-encoding can destroy LSB data).

const MAGIC = [0x58, 0x59, 0x52, 0x4f]; // "XYRO" frame magic
const VERSION = 1;
const HEADER_BYTES = 7; // magic + version + uint16 length
const CRC_BYTES = 4;
const MAX_PAYLOAD_BYTES = 512;
const TILE_PIXELS = 256; // must match lib/server/watermark.ts

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

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readBytesAt(
  data: Uint8ClampedArray,
  startBit: number,
  byteCount: number,
  capacityBits: number,
): Uint8Array | null {
  if (startBit + byteCount * 8 > capacityBits) return null;
  const out = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount * 8; i += 1) {
    const absolute = startBit + i;
    const pixel = Math.floor(absolute / 3);
    const channel = absolute % 3;
    const bit = data[pixel * 4 + channel] & 1;
    out[i >> 3] = (out[i >> 3] << 1) | bit;
  }
  return out;
}

type Found = {
  generationId: string;
  legacyBrand: boolean;
};

function extractFromPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Found | null {
  const capacityBits = width * height * 3;
  for (let ty = 0; ty < height; ty += TILE_PIXELS) {
    for (let tx = 0; tx < width; tx += TILE_PIXELS) {
      const startBit = (ty * width + tx) * 3;
      const header = readBytesAt(data, startBit, HEADER_BYTES, capacityBits);
      if (!header) continue;
      if (!MAGIC.every((byte, i) => header[i] === byte)) continue;
      if (header[4] !== VERSION) continue;
      const length = (header[5] << 8) | header[6];
      if (length === 0 || length > MAX_PAYLOAD_BYTES) continue;
      const rest = readBytesAt(
        data,
        startBit + HEADER_BYTES * 8,
        length + CRC_BYTES,
        capacityBits,
      );
      if (!rest) continue;
      const payloadBytes = rest.subarray(0, length);
      const storedCrc =
        ((rest[length] << 24) |
          (rest[length + 1] << 16) |
          (rest[length + 2] << 8) |
          rest[length + 3]) >>>
        0;
      if (crc32(payloadBytes) !== storedCrc) continue;
      let payload: string;
      try {
        payload = new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes);
      } catch {
        continue;
      }
      const match = /^(truthai|xyro-ai):([^:]+):([0-9a-f]{16})$/.exec(payload);
      if (!match) continue;
      // PRIVACY (owner rule, 2026-11-20): the payload's creator
      // ID (match[3]) is deliberately NOT surfaced here. It is a
      // stable per-creator identifier — showing it publicly
      // would let anyone link all of a person's creations
      // together. Only signed-in TruthAI admins can resolve it,
      // inside the admin panel, for safety investigations.
      return {
        generationId: match[2],
        legacyBrand: match[1] === "xyro-ai",
      };
    }
  }
  return null;
}

type State =
  | { kind: "idle" }
  | { kind: "scanning"; previewUrl: string }
  | { kind: "found"; previewUrl: string; found: Found }
  | { kind: "none"; previewUrl: string }
  | { kind: "error"; message: string };

export default function VerifyImagePage() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const checkFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setState({
        kind: "error",
        message: "That file is not an image. Choose a PNG, JPEG or WebP picture.",
      });
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setState({ kind: "scanning", previewUrl });
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas is unavailable in this browser.");
      context.drawImage(bitmap, 0, 0);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      // Let the "Checking…" state paint before the scan runs.
      await new Promise((resolve) => setTimeout(resolve, 30));
      const found = extractFromPixels(imageData.data, canvas.width, canvas.height);
      bitmap.close();
      setState(
        found
          ? { kind: "found", previewUrl, found }
          : { kind: "none", previewUrl },
      );
    } catch {
      setState({
        kind: "error",
        message:
          "That image could not be read. Try the original PNG file downloaded from TruthAI.",
      });
    }
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void checkFile(file);
    },
    [checkFile],
  );

  return (
    <main className="verify-image">
      <div className="verify-image-card">
        <span className="preview-mark" aria-hidden="true">x</span>
        <h1>TruthAI Image Verifier</h1>
        <p>
          Every picture TruthAI creates carries an invisible watermark woven
          into its pixels. Drop a picture here to check whether it was made
          by TruthAI. No account needed — and the check runs entirely in
          your browser, so your image never leaves your device.
        </p>

        <button
          type="button"
          className={`verify-drop${dragging ? " dragging" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <strong>Drop an image here, or tap to choose one</strong>
          <span>PNG works best — use the original file, not a screenshot.</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void checkFile(file);
            event.target.value = "";
          }}
        />

        {state.kind === "scanning" && (
          <p className="muted" role="status">Checking the pixels…</p>
        )}
        {state.kind === "error" && (
          <p className="form-error" role="alert">{state.message}</p>
        )}
        {(state.kind === "found" || state.kind === "none") && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="verify-preview" src={state.previewUrl} alt="The image you checked" />
          </>
        )}
        {state.kind === "found" && (
          <div className="verify-result found" role="status">
            <strong>✓ Created by TruthAI</strong>
            <p>
              This image carries the TruthAI watermark
              {state.found.legacyBrand
                ? " (an earlier Xyro AI mark — same system, older name)"
                : ""}
              .
            </p>
            <dl className="verify-meta">
              <div>
                <dt>Generation ID</dt>
                <dd>{state.found.generationId}</dd>
              </div>
            </dl>
            <p className="muted">
              Who created it is never shown publicly — the watermark also
              carries a private creator ID, but only TruthAI admins can
              see it, inside the admin panel, so a creator’s images can’t
              be linked together by strangers. If this image concerns
              you, share its Generation ID with us and an admin can trace
              it.
            </p>
          </div>
        )}
        {state.kind === "none" && (
          <div className="verify-result none" role="status">
            <strong>No TruthAI watermark found</strong>
            <p>
              This picture does not carry a readable TruthAI mark. That can
              mean it was not made by TruthAI — or that the mark was lost:
              screenshots, saving as JPEG, heavy editing, resizing and some
              crops destroy the pixel data the watermark lives in. A missing
              mark is never proof that an image is human-made.
            </p>
          </div>
        )}

        <p className="muted">
          For best results, check the original PNG exactly as it was
          downloaded from TruthAI. Read more about how the watermark works
          on the <a href="/xyroaidetect">XyroAIDetect</a> page.
        </p>
      </div>
    </main>
  );
}

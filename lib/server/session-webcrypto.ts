/**
 * Edge-safe verification of the session cookie, implemented on
 * Web Crypto (crypto.subtle) so the Edge middleware does not
 * need to bundle `jose`. The Node-side session code
 * (lib/server/session.ts) still mints and verifies with jose;
 * both check the same contract:
 *
 *  - HS256 signature over header.payload, keyed with
 *    SESSION_SECRET;
 *  - `exp` (seconds) not passed, when present;
 *  - `sub` and `sid` are strings;
 *  - `absExp` (epoch ms, the absolute session cap) not passed,
 *    when present.
 *
 * Interop is pinned by tests/session-webcrypto.test.mjs, which
 * verifies jose-minted tokens with this implementation.
 */

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function utf8ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(text);
  const bytes = new Uint8Array(new ArrayBuffer(encoded.length));
  bytes.set(encoded);
  return bytes;
}

function decodeJsonPart(part: string): Record<string, unknown> {
  const text = new TextDecoder().decode(base64UrlToBytes(part));
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("not an object");
  }
  return parsed as Record<string, unknown>;
}

export async function verifySessionTokenWebCrypto(
  token: string,
  secret: string,
): Promise<boolean> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [headerPart, payloadPart, signaturePart] = parts;

    const header = decodeJsonPart(headerPart);
    if (header.alg !== "HS256") return false;

    const key = await crypto.subtle.importKey(
      "raw",
      utf8ToBytes(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(signaturePart),
      utf8ToBytes(`${headerPart}.${payloadPart}`),
    );
    if (!valid) return false;

    const payload = decodeJsonPart(payloadPart);
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
      return false;
    }
    if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
      return false;
    }
    if (typeof payload.absExp === "number" && payload.absExp <= Date.now()) {
      return false;
    }
    return true;
  } catch {
    return false; // tampered, expired, or malformed — signed out
  }
}

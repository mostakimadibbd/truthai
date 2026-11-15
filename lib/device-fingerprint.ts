/**
 * First-party device fingerprint for login security.
 *
 * At sign-in the client derives a stable device id from ordinary
 * browser signals (user agent, platform, languages, timezone,
 * screen, hardware hints and a small canvas render) and sends only
 * the SHA-256 hash of those signals to the server. The server stores
 * the hash on the session record and in a per-account device
 * registry, which powers the Settings → Security device list,
 * new-device detection and sign-up velocity signals.
 *
 * This is a security signal, not an identity proof: it is spoofable
 * and it is never used as the sole basis for blocking a sign-in.
 * Nothing is persisted client-side beyond a sessionStorage cache for
 * the current tab session; the id is recomputed from the same
 * signals on the next visit. See SECURITY.md ("Device signals").
 */

const CACHE_KEY = "xyro:device-id";
let cached: Promise<string> | null = null;

function canvasSignal(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 220;
    canvas.height = 30;
    const context = canvas.getContext("2d");
    if (!context) return "no-canvas";
    context.textBaseline = "top";
    context.font = "14px 'Arial'";
    context.fillStyle = "#f60";
    context.fillRect(0, 0, 100, 20);
    context.fillStyle = "#069";
    context.fillText("xyro-device-signal", 2, 2);
    return canvas.toDataURL();
  } catch {
    return "canvas-error";
  }
}

function collectSignals(): string {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    platform?: string;
  };
  const screenInfo =
    typeof screen !== "undefined"
      ? `${screen.width}x${screen.height}x${screen.colorDepth}`
      : "no-screen";
  const parts = [
    nav.userAgent ?? "",
    nav.platform ?? "",
    (nav.languages ?? [nav.language ?? ""]).join(","),
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    screenInfo,
    String(nav.hardwareConcurrency ?? ""),
    String(nav.deviceMemory ?? ""),
    String(nav.maxTouchPoints ?? 0),
    canvasSignal(),
  ];
  return parts.join("|");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Non-cryptographic fallback for environments without SubtleCrypto. */
function fallbackHashHex(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0");
  return (hex(h2) + hex(h1)).repeat(4);
}

/**
 * Returns the device id (64 lowercase hex characters), or "" when it
 * cannot be computed. Callers must treat "" as "no signal" — sign-in
 * proceeds without it.
 */
export function getDeviceId(): Promise<string> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return Promise.resolve("");
  }
  try {
    const stored = sessionStorage.getItem(CACHE_KEY);
    if (stored && /^[0-9a-f]{64}$/.test(stored)) return Promise.resolve(stored);
  } catch {
    // Storage unavailable; compute fresh.
  }
  if (!cached) {
    cached = (async () => {
      try {
        const signals = collectSignals();
        const id =
          typeof crypto !== "undefined" && crypto.subtle
            ? await sha256Hex(signals)
            : fallbackHashHex(signals);
        try {
          sessionStorage.setItem(CACHE_KEY, id);
        } catch {
          // Cache is best-effort.
        }
        return id;
      } catch {
        return "";
      }
    })();
  }
  return cached;
}

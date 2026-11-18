import { redisPipeline } from "./redis";

// Realtime log stream, shared with the Python backend: every
// entry lands in ONE capped Upstash Redis list that the admin
// panel streams live (backend/app/logstream.py is the twin).
// The point of the design is what it does NOT touch: Firestore
// — reading the latest logs costs one Redis command and zero
// of the Spark plan's 50k daily Firestore reads. Entries are
// also mirrored to stdout, so Vercel's own log view shows the
// same lines. Best-effort by design: logging never breaks a
// request, and a slow Redis can add at most ~800 ms.

const STREAM_KEY = "xyro:logstream";
const MAX_ENTRIES = 1000;

export type LogLevel = "info" | "warn" | "error";

export async function logEvent(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const text = message.replace(/\s+/g, " ").slice(0, 500);
  console.log(`[truthai] ${level.toUpperCase()} ${text}`);
  const entry = JSON.stringify({
    ts: Date.now(),
    service: "truthai",
    level,
    message: text,
    ...(meta ? { meta } : {}),
  });
  try {
    await Promise.race([
      redisPipeline([
        ["LPUSH", STREAM_KEY, entry],
        ["LTRIM", STREAM_KEY, "0", String(MAX_ENTRIES - 1)],
      ]),
      new Promise((resolve) => setTimeout(resolve, 800)),
    ]);
  } catch {
    // Logging is best-effort; swallow everything.
  }
}

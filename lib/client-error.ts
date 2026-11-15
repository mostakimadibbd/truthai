"use client";

// Shared client-side error reporting for the error boundaries.
// Reports are best-effort only: no personal data, truncated fields, and this
// helper never throws, so it can never take down an error screen itself.

const CHUNK_RELOAD_FLAG = "xyro-chunk-reload-attempted";
const CHUNK_RELOAD_WINDOW_MS = 60_000;

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

export function isChunkLoadError(error: Error & { digest?: string }): boolean {
  const text = `${error.name} ${error.message}`;
  return (
    error.name === "ChunkLoadError" ||
    text.includes("Failed to fetch RSC payload") ||
    text.includes("Loading chunk") ||
    text.includes("ChunkLoadError")
  );
}

// Reload once for stale-chunk errors (common right after a deploy), guarded
// by a timestamped sessionStorage flag so a persistent failure cannot loop.
// Returns true when a reload was started.
export function maybeReloadForChunkError(
  error: Error & { digest?: string },
): boolean {
  if (!isChunkLoadError(error)) return false;
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_FLAG) ?? 0);
    if (Number.isFinite(last) && Date.now() - last < CHUNK_RELOAD_WINDOW_MS) {
      return false;
    }
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(Date.now()));
  } catch {
    // sessionStorage unavailable (private mode etc.) — do not risk a loop.
    return false;
  }
  window.location.reload();
  return true;
}

export function reportClientError(error: Error & { digest?: string }): void {
  console.error("[client-error]", error.message, error.digest ?? "");

  try {
    const payload = JSON.stringify({
      message: truncate(error.message, 500),
      digest: truncate(error.digest, 100),
      name: truncate(error.name, 100),
      path: truncate(window.location.pathname, 200),
    });
    void fetch("/api/client-error", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "xyro",
      },
      body: payload,
      cache: "no-store",
      keepalive: true,
    }).catch(() => {
      // Best effort: the console.error above is the fallback record.
    });
  } catch {
    // Never throw from an error reporter.
  }
}

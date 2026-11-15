"use client";

import { useEffect } from "react";
import { maybeReloadForChunkError, reportClientError } from "@/lib/client-error";

// Global error boundary: replaces the root layout when the layout itself
// fails, so it must render its own <html>/<body> and cannot rely on the
// layout's CSS being present — keep the inline styles minimal and sufficient.
export default function GlobalErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error);
    maybeReloadForChunkError(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#0a090d",
          color: "#f5f2ea",
        }}
      >
        <main style={{ width: "min(650px, calc(100% - 40px))", padding: "40px 0" }}>
          <span style={{ fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Something went wrong
          </span>
          <h1 style={{ fontSize: 40, lineHeight: 1.05, margin: "16px 0 12px" }}>
            Let’s try that again.
          </h1>
          <p style={{ lineHeight: 1.7 }}>
            Xyro AI couldn’t load just now. Reloading usually fixes this.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 12,
              padding: "10px 20px",
              borderRadius: 999,
              border: "1px solid currentColor",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              fontSize: 15,
            }}
          >
            Try again
          </button>
          <details style={{ marginTop: 24 }}>
            <summary>Technical details</summary>
            <p>{error.message || "Unknown error"}</p>
            {error.digest && <p>Reference: {error.digest}</p>}
          </details>
        </main>
      </body>
    </html>
  );
}

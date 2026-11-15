"use client";

import Link from "next/link";
import { useEffect } from "react";
import { maybeReloadForChunkError, reportClientError } from "@/lib/client-error";

export default function ErrorPage({
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
    <section className="error-page" role="alert">
      <span className="eyebrow">Something went wrong</span>
      <h1>Let’s try that again.</h1>
      <p>We couldn’t show this page just now.</p>
      <div className="hero-actions">
        <button className="button button-primary" onClick={() => reset()}>Try again</button>
        <Link href="/" className="button button-quiet">Go home</Link>
      </div>
      <details className="error-details">
        <summary>Technical details</summary>
        <p>{error.message || "Unknown error"}</p>
        {error.digest && <p>Reference: {error.digest}</p>}
      </details>
    </section>
  );
}

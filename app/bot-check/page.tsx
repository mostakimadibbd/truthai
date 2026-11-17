"use client";

import { useCallback, useState } from "react";
import TurnstileWidget from "@/components/turnstile-widget";

// Human-verification landing page for the backend's bot
// protection: when the backend flags a connection as suspicious
// it answers 428 with this page's URL. Completing the Turnstile
// check clears the flag server-side (via /api/bot/verify → the
// backend), so a real human continues while bots stay out.
export default function BotCheckPage() {
  const [resetKey, setResetKey] = useState(0);
  const [state, setState] = useState<"waiting" | "verifying" | "done" | "error">(
    "waiting",
  );
  const [message, setMessage] = useState("");

  const handleToken = useCallback(async (token: string) => {
    if (!token) return;
    setState("verifying");
    try {
      const response = await fetch("/api/bot/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (response.ok) {
        setState("done");
        return;
      }
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setMessage(payload?.error ?? "Verification didn’t pass. Please try again.");
      setState("error");
      setResetKey((key) => key + 1);
    } catch {
      setMessage("Verification service is unreachable. Please try again.");
      setState("error");
      setResetKey((key) => key + 1);
    }
  }, []);

  return (
    <main className="bot-check">
      <div className="bot-check-card">
        <span className="preview-mark" aria-hidden="true">x</span>
        <h1>Quick human check</h1>
        <p>
          We detected unusual activity from this connection, so before
          continuing we just need to confirm you’re a real person. It
          only takes a few seconds.
        </p>
        {state === "done" ? (
          <p className="bot-check-done" role="status">
            ✓ You’re verified — the block is lifted. You can close this
            page and continue where you left off.
          </p>
        ) : (
          <>
            <TurnstileWidget
              action="bot_check"
              resetKey={resetKey}
              onToken={handleToken}
            />
            {state === "verifying" && <p className="muted">Verifying…</p>}
            {state === "error" && (
              <p className="form-error" role="alert">{message}</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}

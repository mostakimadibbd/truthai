"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TurnstileAction } from "@/lib/server/turnstile";

export type { TurnstileAction };

type TurnstileRenderOptions = {
  sitekey: string;
  action: TurnstileAction;
  theme: "auto";
  size: "flexible";
  language: "auto";
  retry: "auto";
  "refresh-expired": "auto";
  appearance?: "interaction-only";
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
  "unsupported-callback": () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_READY_EVENT = "xyro-turnstile-ready";
const TOKEN_TTL_MS = 300_000; // Turnstile tokens are valid for 300 s.

export function notifyTurnstileReady() {
  window.dispatchEvent(new Event(TURNSTILE_READY_EVENT));
}

/**
 * Reusable Cloudflare Turnstile widget (explicit render). Used on the
 * sign-in, sign-up, forgot-password and Google-return flows, each with
 * its own action. Tokens are single-use: the widget resets after every
 * attempt (the parent bumps `resetKey`), and a token is cleared locally
 * after 300 seconds even if Cloudflare hasn't expired it first.
 *
 * Load api.js only where a widget is used — this component includes the
 * <Script> (afterInteractive); Next dedupes it when several widgets are
 * on the page.
 */
export default function TurnstileWidget({
  action,
  resetKey,
  onToken,
  interactionOnly = false,
}: {
  action: TurnstileAction;
  resetKey: number;
  onToken: (token: string) => void;
  interactionOnly?: boolean;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenTimerRef = useRef<number | null>(null);
  const onTokenRef = useRef(onToken);
  const [status, setStatus] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  const clearTokenTimer = useCallback(() => {
    if (tokenTimerRef.current !== null) {
      window.clearTimeout(tokenTimerRef.current);
      tokenTimerRef.current = null;
    }
  }, []);

  const expireToken = useCallback(() => {
    onTokenRef.current("");
    setStatus("The security check expired. Please complete it again.");
    if (widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        // The parent remount (resetKey) is the fallback reset path.
      }
    }
  }, []);

  useEffect(() => {
    if (!siteKey) return;
    let disposed = false;

    function renderWidget() {
      if (disposed || widgetIdRef.current || !window.turnstile || !containerRef.current) return;
      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          theme: "auto",
          size: "flexible",
          language: "auto",
          retry: "auto",
          "refresh-expired": "auto",
          ...(interactionOnly ? { appearance: "interaction-only" as const } : {}),
          callback: (token) => {
            setStatus("");
            onTokenRef.current(token);
            clearTokenTimer();
            tokenTimerRef.current = window.setTimeout(expireToken, TOKEN_TTL_MS);
          },
          "error-callback": () => {
            clearTokenTimer();
            onTokenRef.current("");
            setStatus("The security check couldn’t load. Please try again.");
          },
          "expired-callback": () => {
            clearTokenTimer();
            expireToken();
          },
          "timeout-callback": () => {
            clearTokenTimer();
            onTokenRef.current("");
            setStatus("The security check timed out. Please try again.");
          },
          "unsupported-callback": () => {
            clearTokenTimer();
            onTokenRef.current("");
            setStatus("Your browser doesn’t support the security check. Try a different browser.");
          },
        });
      } catch (error) {
        console.error("Cloudflare Turnstile widget initialization failed.", error);
        onTokenRef.current("");
        setStatus("The security check couldn’t initialize. Please try again.");
      }
    }

    window.addEventListener(TURNSTILE_READY_EVENT, renderWidget);
    renderWidget();
    return () => {
      disposed = true;
      window.removeEventListener(TURNSTILE_READY_EVENT, renderWidget);
      clearTokenTimer();
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Widget already gone.
        }
      }
      widgetIdRef.current = null;
    };
  }, [action, clearTokenTimer, expireToken, interactionOnly, resetKey, retryKey, siteKey]);

  function handleRetry() {
    setLoadFailed(false);
    setStatus("");
    onToken("");
    setRetryKey((key) => key + 1);
  }

  if (!siteKey) {
    return (
      <p className="turnstile-status" role="alert">
        Security verification isn’t configured for this deployment.
      </p>
    );
  }

  return (
    <div className="turnstile-widget">
      <Script
        key={`turnstile-script-${retryKey}`}
        id="cf-turnstile-api"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={notifyTurnstileReady}
        onError={() => {
          setLoadFailed(true);
          setStatus("The security check couldn’t load. Please try again.");
        }}
      />
      <div className="turnstile-field" ref={containerRef} aria-label="Security verification" />
      <p className="turnstile-status" role="status" aria-live="polite">
        {status}
      </p>
      {(loadFailed || status) && (
        <button className="text-button turnstile-retry" type="button" onClick={handleRetry}>
          Retry security check
        </button>
      )}
    </div>
  );
}

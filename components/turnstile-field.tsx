"use client";

import { useEffect, useRef } from "react";

type TurnstileRenderOptions = {
  sitekey: string;
  action: string;
  theme: "dark";
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_READY_EVENT = "xyro-turnstile-ready";

export function notifyTurnstileReady() {
  window.dispatchEvent(new Event(TURNSTILE_READY_EVENT));
}

export default function TurnstileField({
  siteKey,
  resetKey,
  onToken,
  onStatus,
}: {
  siteKey: string;
  resetKey: number;
  onToken: (token: string) => void;
  onStatus: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  const onStatusRef = useRef(onStatus);

  useEffect(() => {
    onTokenRef.current = onToken;
    onStatusRef.current = onStatus;
  }, [onStatus, onToken]);

  useEffect(() => {
    let widgetId: string | null = null;
    let disposed = false;

    function renderWidget() {
      if (disposed || widgetId || !window.turnstile || !containerRef.current) return;
      try {
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action: "create_account",
          theme: "dark",
          callback: (token) => {
            onStatusRef.current("");
            onTokenRef.current(token);
          },
          "error-callback": () => {
            onTokenRef.current("");
            onStatusRef.current("The security check couldn’t load. Please try again.");
          },
          "expired-callback": () => {
            onTokenRef.current("");
            onStatusRef.current("The security check expired. Please complete it again.");
          },
        });
      } catch (error) {
        console.error("Cloudflare Turnstile widget initialization failed.", error);
        onTokenRef.current("");
        onStatusRef.current("The security check couldn’t initialize. Please refresh and try again.");
      }
    }

    window.addEventListener(TURNSTILE_READY_EVENT, renderWidget);
    renderWidget();
    return () => {
      disposed = true;
      window.removeEventListener(TURNSTILE_READY_EVENT, renderWidget);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      widgetId = null;
    };
  }, [resetKey, siteKey]);

  return <div className="turnstile-field" ref={containerRef} aria-label="Security verification" />;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { TYPING_SPEED_CPS, type TypingSpeed } from "@/lib/preferences";

// Client typewriter for streamed assistant text (Phase 3).
//
// The Realtime Database listener delivers the server's text in chunks;
// rendering chunks raw makes replies arrive in jerky blocks. This hook
// keeps an internal buffer of the full text received so far and drains
// it into the displayed string with requestAnimationFrame at the
// user's typing-speed setting:
//   - slow 60 cps, normal 180 cps, fast 600 cps (see lib/preferences)
//   - "instant" (and prefers-reduced-motion) shows text as it arrives
// Draining is adaptive: if the backlog grows past ~1.5 s of output, the
// rate scales up so the display catches up instead of lagging further
// and further behind. Clicking the text (skip) flushes the buffer.

export function useTypewriter(
  fullText: string,
  speed: TypingSpeed,
  active: boolean,
): { displayed: string; skip: () => void } {
  const [displayed, setDisplayed] = useState(fullText);
  const displayedRef = useRef(fullText);
  const targetRef = useRef(fullText);
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  const instant =
    speed === "instant" ||
    (typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    targetRef.current = fullText;

    if (instant || !active) {
      displayedRef.current = fullText;
      setDisplayed(fullText);
      return;
    }

    // If the target shrank (new message / regenerate), snap to it.
    if (!fullText.startsWith(displayedRef.current)) {
      displayedRef.current = "";
      setDisplayed("");
    }

    const cps = TYPING_SPEED_CPS[speed as Exclude<TypingSpeed, "instant">];
    cancelAnimationFrame(rafRef.current);
    lastTickRef.current = performance.now();

    const tick = (now: number) => {
      const target = targetRef.current;
      const current = displayedRef.current;
      if (current.length >= target.length) {
        if (current !== target) {
          displayedRef.current = target;
          setDisplayed(target);
        }
        return;
      }
      const elapsedSeconds = Math.max(0, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;
      const backlog = target.length - current.length;
      // Adaptive catch-up: beyond 1.5 s of backlog, drain proportionally
      // faster so long replies converge instead of trailing.
      const backlogSeconds = backlog / cps;
      const rateMultiplier =
        backlogSeconds > 1.5 ? Math.min(8, backlogSeconds / 1.5) : 1;
      const advance = Math.max(
        1,
        Math.floor(cps * rateMultiplier * elapsedSeconds),
      );
      const next = target.slice(0, current.length + advance);
      displayedRef.current = next;
      setDisplayed(next);
      if (next.length < target.length) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [fullText, speed, active, instant]);

  const skip = () => {
    cancelAnimationFrame(rafRef.current);
    displayedRef.current = targetRef.current;
    setDisplayed(targetRef.current);
  };

  return { displayed, skip };
}

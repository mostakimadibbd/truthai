"use client";

import { useEffect, useRef } from "react";

// Reusable sign-out confirmation (Phase 2). Used by the site header
// menu, the chat sidebar and the settings/account panel so signing out
// is never a single accidental click.
//
// Accessibility: role="alertdialog", aria-modal, Cancel is focused by
// default, Tab is trapped between the two buttons, Escape closes, and
// focus returns to the element that opened the dialog when it closes.

export type SignOutVariant = "single" | "all";

const COPY: Record<
  SignOutVariant,
  { title: string; body: string; confirm: string }
> = {
  single: {
    title: "Sign out of Xyro AI?",
    body: "You’ll need to sign in again to open your chats.",
    confirm: "Sign out",
  },
  all: {
    title: "Sign out of all devices?",
    body: "Every signed-in device will need to sign in again to open your chats. Access from other devices stops right away.",
    confirm: "Sign out of all devices",
  },
};

export default function SignOutDialog({
  open,
  variant,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  variant: SignOutVariant;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    cancelRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busy) onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      // Focus trap: keep Tab cycling between Cancel and the confirm
      // button while the dialog is open.
      const focusable = [cancelRef.current, confirmRef.current].filter(
        (element): element is HTMLButtonElement => element !== null,
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      // Focus returns to the trigger.
      const trigger = triggerRef.current;
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, [open, busy, onCancel]);

  if (!open) return null;
  const copy = COPY[variant];

  return (
    <div
      className="signout-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="signout-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="signout-dialog-title"
        aria-describedby="signout-dialog-body"
      >
        <h2 id="signout-dialog-title">{copy.title}</h2>
        <p id="signout-dialog-body">{copy.body}</p>
        <div className="signout-dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="button button-outline"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="button button-danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Signing out…" : copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import dynamic from "next/dynamic";

/**
 * First-load diet for /chat: the workspace (chat UI + Firebase
 * Firestore/RTDB SDKs, ~200 kB gz of vendor code) is split out
 * of the route's first load and fetched as soon as the shell
 * paints. The loading state mirrors the workspace's own auth
 * gate markup, so the handoff is seamless — the workspace was
 * already gated on auth and history loading behind the same
 * card. Markdown was split the same way inside the workspace.
 */
const ChatWorkspace = dynamic(() => import("./chat-workspace"), {
  ssr: false,
  loading: () => (
    <div className="chat-gate">
      <div className="chat-gate-card">
        <span className="chat-brand-mark" aria-hidden="true">
          x
        </span>
        <p role="status">Opening your workspace…</p>
      </div>
    </div>
  ),
});

export default function ChatShell() {
  return <ChatWorkspace />;
}

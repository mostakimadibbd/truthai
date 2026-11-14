import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Workspace",
  description: "Your private Xyro AI workspace.",
  robots: { index: false, follow: false },
};

export default function ChatPage() {
  return (
    <main className="page-width" style={{ minHeight: "60vh", padding: "72px 0 120px" }}>
      <div className="account-card" style={{ maxWidth: 820, margin: "0 auto" }}>
        <span className="eyebrow">Workspace</span>
        <h1 style={{ margin: "18px 0 12px", fontSize: "clamp(2.2rem, 4vw, 3.4rem)" }}>Your Xyro AI workspace</h1>
        <p style={{ color: "#a49eab", lineHeight: 1.8 }}>
          This is the chat entry point. The product experience is intentionally kept under active development, but the route is in place for authenticated users.
        </p>
      </div>
    </main>
  );
}

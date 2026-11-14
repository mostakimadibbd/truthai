import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings",
  description: "Your Xyro AI account settings.",
  robots: { index: false, follow: false },
};

export default function SettingsPage() {
  return (
    <main className="page-width" style={{ minHeight: "60vh", padding: "72px 0 120px" }}>
      <div className="account-card" style={{ maxWidth: 820, margin: "0 auto" }}>
        <span className="eyebrow">Account settings</span>
        <h1 style={{ margin: "18px 0 12px", fontSize: "clamp(2.2rem, 4vw, 3.4rem)" }}>Settings</h1>
        <p style={{ color: "#a49eab", lineHeight: 1.8 }}>
          This page is intentionally minimal right now while the account, security, and developer features are being wired in.
        </p>
      </div>
    </main>
  );
}

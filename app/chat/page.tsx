import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Workspace",
  description: "Your Xyro AI workspace.",
  robots: { index: false, follow: false },
};

const tools = [
  { icon: "✦", title: "Chat", description: "Think through a question and shape your next step.", status: "In development" },
  { icon: "▤", title: "Projects", description: "Keep related conversations and ideas together.", status: "Coming later" },
  { icon: "⌘", title: "Personalize", description: "Choose the way you want to work with AI.", status: "Coming later" },
];

export default function ChatPage() {
  return (
    <section className="workspace-page page-width">
      <header className="workspace-heading">
        <div>
          <span className="eyebrow">Your workspace</span>
          <h1>Good to have you here.</h1>
          <p>
            Your account is ready. The chat experience is still being built, so
            we&apos;ll make it available here when it&apos;s ready to use.
          </p>
        </div>
        <span className="workspace-badge"><i /> Account foundation is live</span>
      </header>

      <div className="workspace-grid">
        {tools.map((tool) => (
          <article className="workspace-tile" key={tool.title}>
            <span className="workspace-tile-icon" aria-hidden="true">{tool.icon}</span>
            <h2>{tool.title}</h2>
            <p>{tool.description}</p>
            <span className="workspace-status">{tool.status}</span>
          </article>
        ))}
      </div>

      <aside className="workspace-callout">
        <span className="workspace-callout-icon" aria-hidden="true">✦</span>
        <p>
          <strong>We won&apos;t pretend a feature is ready before it is.</strong>{" "}
          You can manage your account details in settings, or read how the
          product is being developed.
        </p>
      </aside>
      <div className="hero-actions workspace-actions">
        <Link href="/settings" className="button button-outline">Account settings <span aria-hidden="true">→</span></Link>
        <Link href="/help" className="button button-quiet">Read the guide <span aria-hidden="true">→</span></Link>
      </div>
    </section>
  );
}

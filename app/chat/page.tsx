import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Workspace",
  description: "Your Xyro AI workspace.",
  robots: { index: false, follow: false },
};

const tools = [
  { icon: "✦", title: "AI chat", description: "Ask questions, brainstorm, draft, and iterate in one focused conversation.", status: "In development" },
  { icon: "◈", title: "Model selection", description: "Choose from a curated range of AI models when integrations are ready.", status: "Planned" },
  { icon: "⌕", title: "Research and sources", description: "Explore information with source links so you can verify important claims.", status: "Planned" },
  { icon: "▤", title: "Files and images", description: "Bring documents or images into a conversation for analysis.", status: "Planned" },
  { icon: "▧", title: "Projects and context", description: "Keep related conversations and working context organized together.", status: "Planned" },
  { icon: "⌘", title: "Custom assistants", description: "Create reusable instructions for the kinds of tasks you do often.", status: "Planned" },
];

export default function ChatPage() {
  return (
    <section className="workspace-page page-width">
      <header className="workspace-heading">
        <div>
          <span className="eyebrow">Your workspace</span>
          <h1>A thoughtful space for AI work.</h1>
          <p>
            Your account is ready. We&apos;re building the AI experience now;
            these capabilities are not live yet.
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
          Chat, model connections, research, and file analysis are not available
          yet. You can manage your account or read how the product is being developed.
        </p>
      </aside>
      <div className="hero-actions workspace-actions">
        <Link href="/settings" className="button button-outline">Account settings <span aria-hidden="true">→</span></Link>
        <Link href="/help" className="button button-quiet">Read the guide <span aria-hidden="true">→</span></Link>
      </div>
    </section>
  );
}

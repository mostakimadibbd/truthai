import Link from "next/link";

const principles = [
  {
    number: "01",
    title: "Start anywhere",
    copy: "Bring a question, a half-formed thought, or a piece of work you want to understand.",
  },
  {
    number: "02",
    title: "Find your next step",
    copy: "Explore ideas, ask follow-ups, and shape a useful direction at your own pace.",
  },
  {
    number: "03",
    title: "Keep your judgment",
    copy: "AI can help you think. You stay in control of what you trust, save, and share.",
  },
];

export default function Home() {
  return (
    <>
      <section className="home-hero page-width">
        <div className="home-hero-copy">
          <span className="eyebrow"><span className="eyebrow-dot" /> A thoughtful AI workspace</span>
          <h1>Make room for<br /><span className="gradient-text">what&apos;s next.</span></h1>
          <p>
            A calm place to ask better questions, work through ideas, and find a
            useful next step—with AI that keeps your judgment in the picture.
          </p>
          <div className="hero-actions">
            <Link href="/sign-up" className="button button-primary">
              Create your free account <span aria-hidden="true">↗</span>
            </Link>
            <Link href="/help" className="button button-quiet">
              See how it works <span aria-hidden="true">→</span>
            </Link>
          </div>
          <p className="hero-note">Start free. No payment details required.</p>
        </div>

        <div className="workspace-preview" aria-label="Illustrative workspace preview">
          <div className="preview-topbar">
            <span className="preview-brand"><span className="preview-mark">x</span> xyro<span>ai</span></span>
            <span className="preview-status"><i /> Workspace preview</span>
          </div>
          <div className="preview-body">
            <span className="preview-label">A place to begin</span>
            <p className="preview-question">What would you like to make progress on?</p>
            <div className="preview-suggestions">
              <span><i aria-hidden="true">✦</i> Untangle an idea</span>
              <span><i aria-hidden="true">⌘</i> Learn something new</span>
              <span><i aria-hidden="true">↗</i> Find a first step</span>
            </div>
            <div className="preview-composer">
              <span>Start with a question or thought…</span>
              <span className="preview-send" aria-hidden="true">↑</span>
            </div>
            <span className="preview-disclaimer">Illustrative preview · text chat is now available</span>
          </div>
          <span className="preview-glow preview-glow-one" aria-hidden="true" />
          <span className="preview-glow preview-glow-two" aria-hidden="true" />
        </div>
      </section>

      <section className="value-strip" aria-label="Product principles">
        <div className="page-width value-strip-inner">
          <span><i aria-hidden="true">✳</i> Thoughtful by design</span>
          <span><i aria-hidden="true">◌</i> Clear about AI&apos;s limits</span>
          <span><i aria-hidden="true">⌁</i> Your work stays yours</span>
        </div>
      </section>

      <section className="section page-width">
        <div className="section-heading">
          <span className="eyebrow">A better way to begin</span>
          <h2>Less pressure to know.<br /><span className="gradient-text">More room to explore.</span></h2>
          <p>
            You don&apos;t need a perfect prompt or a fully formed plan. Start
            with what you have; make the next move clearer as you go.
          </p>
        </div>
        <div className="principle-grid">
          {principles.map((item) => (
            <article className="principle-card" key={item.number}>
              <span className="principle-number">{item.number}</span>
              <span className="principle-glyph" aria-hidden="true">
                {item.number === "01" ? "✳" : item.number === "02" ? "↗" : "◌"}
              </span>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section section-quiet">
        <div className="page-width clarity-section">
          <div className="clarity-copy">
            <span className="eyebrow">Made for real work</span>
            <h2>Useful tools.<br />No unnecessary noise.</h2>
            <p>
              Start with a text conversation, then build on it with thoughtful
              creative tools and more ways to work with your material as they
              become ready.
            </p>
            <Link href="/help" className="text-link">Explore the guide <span aria-hidden="true">→</span></Link>
          </div>
          <div className="clarity-cards" aria-label="Workspace principles">
            <article>
              <span className="clarity-icon" aria-hidden="true">01</span>
              <div><h3>Conversation</h3><p>Ask naturally. Refine the direction as you go.</p></div>
              <span className="clarity-state">Available · text chat</span>
            </article>
            <article>
              <span className="clarity-icon" aria-hidden="true">02</span>
              <div><h3>Work with context</h3><p>Bring ideas and material into the conversation.</p></div>
              <span className="clarity-state">Planned</span>
            </article>
            <article>
              <span className="clarity-icon" aria-hidden="true">03</span>
              <div><h3>Stay in control</h3><p>Clear controls and honest limits come first.</p></div>
              <span className="clarity-state">Our principle</span>
            </article>
          </div>
        </div>
      </section>

      <section className="section page-width faq-section">
        <div className="section-heading">
          <span className="eyebrow">Good to know</span>
          <h2>Clear answers<br />before you begin.</h2>
          <p>Have another question? Our guide has more detail on the service and its limits.</p>
          <Link href="/help" className="text-link">Visit the help center <span aria-hidden="true">→</span></Link>
        </div>
        <div className="faq-list">
          <details>
            <summary>Can AI get things wrong?<span aria-hidden="true">＋</span></summary>
            <p>Yes. AI can produce incomplete, outdated, or incorrect responses. Check important facts with reliable sources, especially before consequential decisions.</p>
          </details>
          <details>
            <summary>Is chat available now?<span aria-hidden="true">＋</span></summary>
            <p>Text chat is available after you verify your email. It uses OpenRouter’s free model pool when configured, and your chat history is saved in this browser only. Attachments, research, image generation, and cross-device sync are not available yet.</p>
          </details>
          <details>
            <summary>What does it cost to get started?<span aria-hidden="true">＋</span></summary>
            <p>There is no payment flow or subscription available on this site. Check the plans page for the latest availability information.</p>
          </details>
        </div>
      </section>

      <section className="closing-cta">
        <div className="page-width closing-cta-inner">
          <span className="eyebrow">Your next idea can start small</span>
          <h2>Ready when you are.</h2>
          <p>Create an account, verify your email, and start a text conversation.</p>
          <Link href="/sign-up" className="button button-primary">
            Create your free account <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>
    </>
  );
}

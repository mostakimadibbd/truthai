import Link from "next/link";
import { siteUrl } from "@/lib/site";

const capabilities = [
  {
    number: "01",
    title: "Think it through",
    text: "Work through a tricky question, learn a new concept, or turn a rough idea into a clear plan.",
  },
  {
    number: "02",
    title: "Bring your work",
    text: "Ask questions about documents and data, and keep the context that matters close at hand.",
  },
  {
    number: "03",
    title: "Make something",
    text: "Explore writing, code, and images with tools designed to help you move from thought to draft.",
  },
];

const questions = [
  {
    q: "Can AI get things wrong?",
    a: "Yes. AI can produce incomplete, outdated, or incorrect responses. Check important facts with reliable sources, especially before making consequential decisions.",
  },
  {
    q: "What happens to the images Xyro AI creates?",
    a: "Generated images are intended to carry a visible Xyro AI mark and an invisible signal. The signal can be damaged or removed by substantial editing, and detection is not a guarantee of origin.",
  },
  {
    q: "Does Xyro AI have a free plan?",
    a: "Plan availability and limits will be published here before accounts or paid subscriptions are offered.",
  },
  {
    q: "Can I use Xyro AI without an account?",
    a: "Google and email/password sign-in are available when Firebase is configured. Guest access is not available, and chat features are still in development.",
  },
];

export default function Home() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Xyro AI",
    applicationCategory: "ProductivityApplication",
    description:
      "A thoughtful workspace for asking questions, exploring ideas, and creating with AI.",
    url: siteUrl,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <section className="hero page-width">
        <div className="hero-copy">
          <span className="eyebrow"><span className="eyebrow-dot" /> A clearer space to think</span>
          <h1>Big questions.<br /><span className="gradient-text">Better starting points.</span></h1>
          <p className="hero-lede">
            Xyro AI brings conversation, research, and creative tools into one
            calm workspace—so you can spend less time getting started and more
            time moving ideas forward.
          </p>
          <div className="hero-actions">
            <Link href="/sign-in" className="button button-primary">
              Sign in to Xyro AI <span aria-hidden="true">↗</span>
            </Link>
            <Link href="/help" className="button button-quiet">See how it works</Link>
          </div>
          <p className="hero-note">AI can make mistakes. Keep your judgment in the loop.</p>
        </div>
        <div className="product-card" aria-label="Illustration of an AI conversation">
          <div className="card-window-bar">
            <span className="window-dots" aria-hidden="true"><i /><i /><i /></span>
            <span className="window-label">A new conversation</span>
            <span className="window-menu" aria-hidden="true">···</span>
          </div>
          <div className="conversation">
            <div className="user-bubble">How do I turn a big idea into a first step?</div>
            <div className="assistant-answer">
              <span className="answer-mark" aria-hidden="true">x</span>
              <div>
                <p>Start by making the idea smaller—not less ambitious, just easier to act on.</p>
                <ol>
                  <li>Name the outcome you want.</li>
                  <li>Write down what you already know.</li>
                  <li>Choose one thing you can test this week.</li>
                </ol>
                <p className="answer-question">Want to tell me what you’re working on?</p>
              </div>
            </div>
            <div className="demo-composer">
              <span>Ask a follow-up or start a new thought</span>
              <span className="send-symbol" aria-hidden="true">↑</span>
            </div>
            <span className="demo-caption">A little momentum, one good question at a time.</span>
          </div>
        </div>
        <div className="hero-orbit orbit-one" aria-hidden="true" />
        <div className="hero-orbit orbit-two" aria-hidden="true" />
      </section>

      <section className="trust-strip" aria-label="Product principles">
        <div className="page-width trust-items">
          <span><i aria-hidden="true">✳</i> Useful by design</span>
          <span><i aria-hidden="true">⌁</i> Your judgment stays central</span>
          <span><i aria-hidden="true">◌</i> Clear about AI’s limits</span>
        </div>
      </section>

      <section className="section page-width">
        <div className="section-heading">
          <span className="eyebrow">One workspace, many ways forward</span>
          <h2>Make space for the work<br />behind the question.</h2>
          <p>Some days you need an answer. Some days you need a better question. Xyro AI is being built for both.</p>
        </div>
        <div className="capability-grid">
          {capabilities.map((item) => (
            <article className="capability-card" key={item.number}>
              <span className="card-number">{item.number}</span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
              <span className="card-arrow" aria-hidden="true">↗</span>
            </article>
          ))}
        </div>
      </section>

      <section className="section section-muted">
        <div className="page-width steps-layout">
          <div className="section-heading steps-intro">
            <span className="eyebrow">A simple way in</span>
            <h2>From first thought<br />to next step.</h2>
            <p>You don’t need a perfect prompt or a fully formed plan. Start where you are.</p>
            <Link href="/help" className="text-link">Explore the guide <span aria-hidden="true">→</span></Link>
          </div>
          <div className="steps-list">
            <article><span>1</span><div><h3>Say what you’re thinking</h3><p>Ask naturally. Add context as you go, or share a file when it helps explain the task.</p></div></article>
            <article><span>2</span><div><h3>Shape the conversation</h3><p>Ask for another angle, request a simpler explanation, or point out what needs to change.</p></div></article>
            <article><span>3</span><div><h3>Take what’s useful</h3><p>Review the response, verify important details, and carry the useful parts into your work.</p></div></article>
          </div>
        </div>
      </section>

      <section className="section page-width">
        <div className="feature-split">
          <div className="feature-visual file-visual" aria-hidden="true">
            <div className="file-sheet"><span className="file-badge">PDF</span><i /><i /><i className="short" /><i /><i /></div>
            <div className="file-question"><span>Ask about this file</span><span className="mini-arrow">↑</span></div>
            <span className="file-sparkle">✳</span>
          </div>
          <div className="feature-copy">
            <span className="eyebrow">Bring the context</span>
            <h2>Make dense material<br />easier to work with.</h2>
            <p>File analysis is designed to help you summarize, compare, and ask questions about the material you provide. Always check the source when accuracy matters.</p>
            <Link href="/help#files" className="text-link">How file analysis works <span aria-hidden="true">→</span></Link>
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="page-width feature-split reverse">
          <div className="feature-copy">
            <span className="eyebrow">Create with care</span>
            <h2>Images with their<br />origin in mind.</h2>
            <p>When image generation becomes available, generated outputs are intended to include a visible Xyro AI label and an embedded signal. Those signals can be altered or lost, so they should not be treated as proof on their own.</p>
            <Link href="/xyroaidetect" className="text-link">About XyroAIDetect <span aria-hidden="true">→</span></Link>
          </div>
          <div className="feature-visual image-visual" aria-hidden="true">
            <div className="image-art"><span className="sun" /><span className="hill hill-back" /><span className="hill hill-front" /><span className="image-watermark">XYRO AI</span></div>
            <span className="image-caption">A visible label is one layer, not a guarantee.</span>
          </div>
        </div>
      </section>

      <section className="section page-width detect-band">
        <div>
          <span className="eyebrow">A signal, not a verdict</span>
          <h2>Meet XyroAIDetect.</h2>
        </div>
        <p>Learn how Xyro AI’s planned image detector is expected to work, what it may recognize, and where its limits are.</p>
        <Link className="button button-outline" href="/xyroaidetect">Explore the detector <span aria-hidden="true">↗</span></Link>
      </section>

      <section className="section section-muted">
        <div className="page-width">
          <div className="section-heading plans-heading">
            <span className="eyebrow">Plans</span>
            <h2>Clear choices, when they’re ready.</h2>
            <p>We’ll publish plan details and usage limits before subscriptions are offered.</p>
          </div>
          <div className="plans-preview">
            <div><span className="plan-tag">Free</span><h3>A place to begin</h3><p>Core access and daily limits will be described here before launch.</p><span className="plan-status">Details coming before launch</span></div>
            <div className="plan-highlight"><span className="plan-tag">Pro</span><h3>More room to explore</h3><p>Any paid plan will clearly explain its features, limits, and price before purchase.</p><span className="plan-status">No subscriptions available yet</span></div>
          </div>
          <p className="plans-link"><Link className="text-link" href="/pricing">Read about plans <span aria-hidden="true">→</span></Link></p>
        </div>
      </section>

      <section className="section page-width faq-section">
        <div className="section-heading">
          <span className="eyebrow">A few good questions</span>
          <h2>Good to know.</h2>
        </div>
        <div className="faq-list">
          {questions.map(({ q, a }) => (
            <details key={q}>
              <summary>{q}<span aria-hidden="true">＋</span></summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}

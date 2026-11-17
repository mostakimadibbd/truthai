import type { Metadata } from "next";
import Link from "next/link";
import "./landing-more.css";

export const metadata: Metadata = {
  title: { absolute: "Xyro AI — free AI chat with open models" },
  description:
    "Xyro AI is a free AI chat workspace powered by OpenRouter's free models. Ask questions, analyse files, and pick the model that fits — no card, no subscription.",
};

const features = [
  {
    glyph: "✦",
    title: "Free AI models, seriously free",
    copy: "Every conversation runs on OpenRouter's free model pool. There is no paid tier, no card on file, and no surprise bill — when a model costs money, Xyro AI simply doesn't offer it.",
    state: "Available",
  },
  {
    glyph: "⌘",
    title: "Three modes, zero fuss",
    copy: "Pick Fast for quick answers, Thinking for deeper reasoning, or Lightweight for simple tasks. If one route is busy, chat falls back automatically instead of failing.",
    state: "Available",
  },
  {
    glyph: "↗",
    title: "Files in, answers out",
    copy: "Attach images, PDFs, and TXT, Markdown or CSV files (up to 10 MB each, five per message). Vision-capable free models can read your images; document text is extracted and analysed in the conversation.",
    state: "Available",
  },
  {
    glyph: "◍",
    title: "Create images",
    copy: "Describe a picture in the composer's + menu and Xyro AI creates it with a free image-capable model. Every created image carries an invisible Xyro AI watermark and is stored as private Cloudinary media. If no free image model is available at that moment, the app says so — it never fakes a result.",
    state: "Available",
  },
  {
    glyph: "⌁",
    title: "Private by design",
    copy: "Sign-in is gated by Cloudflare Turnstile and a signed server session, uploads are stored as authenticated Cloudinary assets, and you can export or delete everything from Settings at any time.",
    state: "Available",
  },
  {
    glyph: "◌",
    title: "History that follows you",
    copy: "Chats are stored in Firestore and sync across your devices, with replies streaming live through Realtime Database. Rename, search, export or delete any conversation from the sidebar.",
    state: "Available",
  },
];

const steps = [
  {
    number: "01",
    title: "Create your free account",
    copy: "Sign up with email or Google, pass a quick human check, and verify your email. That is the whole onboarding — no payment details, ever.",
  },
  {
    number: "02",
    title: "Pick a mode, or don't",
    copy: "Start with Fast for zero decisions, or switch modes per chat from the picker at the top. Your default lives in Settings → General.",
  },
  {
    number: "03",
    title: "Ask, attach, iterate",
    copy: "Ask a question, attach a file for analysis, and follow up to refine the answer. Stop or regenerate a reply whenever it drifts.",
  },
];

const exampleModels = [
  { name: "Fast", maker: "Everyday answers", note: "Quick, low-latency replies for chat and everyday questions." },
  { name: "Thinking", maker: "Hard problems", note: "Deeper reasoning for coding, analysis and long questions." },
  { name: "Lightweight", maker: "Simple tasks", note: "Light, efficient models for short and simple requests." },
];

const useCases = [
  {
    glyph: "✎",
    audience: "Students",
    copy: "Understand difficult material, summarise readings and PDFs, and practise with questions before the exam.",
    href: "/for-students",
    cta: "Xyro AI for students",
  },
  {
    glyph: "✒",
    audience: "Writers",
    copy: "Outlines, restructuring and line-level polish for articles, essays and books — with your voice in charge.",
    href: "/for-writers",
    cta: "Xyro AI for writers",
  },
  {
    glyph: "▶",
    audience: "Creators",
    copy: "Hooks, scripts, captions and created images for the channels you publish on, all from one chat.",
    href: "/for-creators",
    cta: "Xyro AI for creators",
  },
  {
    glyph: "</>",
    audience: "Developers",
    copy: "An OpenAI-compatible API on the same free models — 100,000 tokens a day, keys you name, a real dashboard.",
    href: "/developers",
    cta: "Xyro AI for developers",
  },
  {
    glyph: "◈",
    audience: "Business & teams",
    copy: "Drafting, summarising and brainstorming for small teams, with the free-service limits stated plainly.",
    href: "/for-business",
    cta: "Xyro AI for business",
  },
];

const conversationSteps = [
  {
    number: "1",
    title: "Ask anything",
    copy: "Type your question, or attach an image, PDF or document when the answer depends on one. Custom instructions mean the model already knows your context.",
  },
  {
    number: "2",
    title: "Get a streamed answer from a free model",
    copy: "Replies stream in live from OpenRouter's free pool — Auto routing, or a model you picked. Stop or regenerate whenever a reply drifts.",
  },
  {
    number: "3",
    title: "Continue, export, or build on it",
    copy: "Keep iterating in the same chat, export it as Markdown, pin it for later — or take the same models into your own app through the developer API.",
  },
];

const apiSnippet = String.raw`curl https://truthai-six.vercel.app/api/v1/chat/completions \
  -H "Authorization: Bearer xyro_sk_live_…" \
  -H "Content-Type: application/json" \
  -d '{ "messages": [{ "role": "user", "content": "Hello!" }] }'`;

const faqTeaser = [
  {
    q: "Is Xyro AI really free?",
    a: "Yes. Xyro AI runs entirely on free tiers — OpenRouter's free models, Firebase's Spark plan, Cloudinary, Upstash and Vercel Hobby. There is no paid plan and nothing to buy. The trade-off is fair-use limits, which the pricing page explains honestly.",
  },
  {
    q: "Which AI models can I use?",
    a: "Three modes, all free: Fast for everyday questions, Thinking for harder problems and code, and Lightweight for simple tasks. Behind the scenes each mode draws on a pool of free models and falls back automatically when one is busy, so an answer always arrives.",
  },
  {
    q: "What files can I analyse?",
    a: "Images (JPG, PNG, WebP, GIF) and documents (PDF, TXT, Markdown, CSV), up to 10 MB per file and five files per message. Files are stored privately in Cloudinary and are deleted when you delete the chat or the file.",
  },
  {
    q: "Is my data used to train models?",
    a: "Xyro AI does not train models. Your prompts are sent to OpenRouter and the selected model provider to generate a reply, and those providers handle data under their own policies. Don't send sensitive information — the privacy notice explains the full picture.",
  },
];

export default function Home() {
  return (
    <>
      <section className="home-hero page-width">
        <div className="home-hero-copy">
          <span className="eyebrow"><span className="eyebrow-dot" /> Free AI chat · No card required</span>
          <h1>Meet Xyro AI.<br /><span className="gradient-text">Big answers, zero cost.</span></h1>
          <p>
            A calm, capable AI workspace powered by OpenRouter&apos;s free
            models. Ask questions, analyse files, and pick the model that
            fits the task — free, private, and synced across your devices.
          </p>
          <div className="hero-actions">
            <Link href="/sign-up" className="button button-primary">
              Get started free <span aria-hidden="true">↗</span>
            </Link>
            <Link href="/sign-in" className="button button-quiet">
              Sign in <span aria-hidden="true">→</span>
            </Link>
          </div>
          <p className="hero-note">Free forever · No payment details · Verify your email and start chatting</p>
        </div>

        <div className="landing-mock" aria-label="Illustrative preview of the Xyro AI chat workspace">
          <div className="landing-mock-topbar">
            <span className="preview-brand"><span className="preview-mark">x</span> xyro<span>ai</span></span>
            <span className="landing-mock-model"><i /> Fast</span>
          </div>
          <div className="landing-mock-body">
            <div className="landing-mock-user">
              <span className="landing-mock-chip">📄 report-q3.pdf</span>
              <p>What are the three biggest risks in this report?</p>
            </div>
            <div className="landing-mock-assistant">
              <p>Based on the document, the three biggest risks are:</p>
              <ol>
                <li><strong>Supplier concentration</strong> — two vendors cover 71% of inputs (p. 4).</li>
                <li><strong>Currency exposure</strong> — unhedged purchases rose this quarter (p. 9).</li>
                <li><strong>Churn in the SMB segment</strong> — up 1.8 points since June (p. 12).</li>
              </ol>
              <p>Want a mitigation plan for any of these?</p>
            </div>
          </div>
          <div className="landing-mock-composer">
            <span className="landing-mock-plus" aria-hidden="true">+</span>
            <span>Message Xyro AI…</span>
            <span className="preview-send" aria-hidden="true">↑</span>
          </div>
          <span className="preview-disclaimer">Illustrative preview of the chat workspace</span>
          <span className="preview-glow preview-glow-one" aria-hidden="true" />
          <span className="preview-glow preview-glow-two" aria-hidden="true" />
        </div>
      </section>

      <section className="value-strip" aria-label="Why Xyro AI">
        <div className="page-width value-strip-inner">
          <span><i aria-hidden="true">✳</i> Free models via OpenRouter</span>
          <span><i aria-hidden="true">⌁</i> Private, authenticated file storage</span>
          <span><i aria-hidden="true">◌</i> Synced across your devices</span>
        </div>
      </section>

      <section className="section page-width">
        <div className="section-heading">
          <span className="eyebrow">What you can do</span>
          <h2>Everything a modern AI chat does.<br /><span className="gradient-text">Without the bill.</span></h2>
          <p>
            Xyro AI is built entirely on free tiers and says so plainly.
            Here is what that gets you today.
          </p>
        </div>
        <div className="feature-grid">
          {features.map((feature) => (
            <article className="feature-card" key={feature.title}>
              <span className="feature-glyph" aria-hidden="true">{feature.glyph}</span>
              <h3>{feature.title}</h3>
              <p>{feature.copy}</p>
              <span className={feature.state === "Available" ? "feature-state feature-state-live" : "feature-state"}>
                {feature.state}
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="section page-width">
        <div className="section-heading">
          <span className="eyebrow">Use cases</span>
          <h2>However you work,<br /><span className="gradient-text">start with a question.</span></h2>
          <p>
            Students, writers, creators, developers and small teams use the
            same free workspace in different ways. Pick your page — each one
            is honest about what the free service can and can&apos;t do.
          </p>
          <Link href="/use-cases" className="text-link">See all use cases <span aria-hidden="true">→</span></Link>
        </div>
        <div className="more-usecases">
          {useCases.map((item) => (
            <Link className="more-usecase-card" href={item.href} key={item.audience}>
              <span className="more-usecase-glyph" aria-hidden="true">{item.glyph}</span>
              <h3>{item.audience}</h3>
              <p>{item.copy}</p>
              <span className="more-usecase-arrow">{item.cta} <span aria-hidden="true">→</span></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section section-quiet">
        <div className="page-width">
          <div className="section-heading">
            <span className="eyebrow">How it works</span>
            <h2>From sign-up to first answer<br />in about a minute.</h2>
          </div>
          <div className="principle-grid">
            {steps.map((step) => (
              <article className="principle-card" key={step.number}>
                <span className="principle-number">{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section page-width">
        <div className="section-heading">
          <span className="eyebrow">Models</span>
          <h2>Free models, routed honestly.</h2>
          <p>
            Xyro AI only ever calls free models — never anything paid.
            You choose the experience, not the machinery: Fast, Thinking
            or Lightweight. Each mode draws on a pool of free models and
            falls back automatically when one is busy, and we show busy
            times honestly instead of quietly switching you to anything
            paid. The three modes:
          </p>
        </div>
        <ul className="model-list">
          {exampleModels.map((model) => (
            <li key={model.name}>
              <strong>{model.name}</strong>
              <span>{model.maker}</span>
              <span>{model.note}</span>
            </li>
          ))}
        </ul>
        <p className="model-note">
          Switch modes any time from the picker at the top of the chat,
          and set your default in Settings → General. We publish no
          benchmark scores — free-model performance varies, and the
          honest test is trying your own prompt.
        </p>
        <Link href="/models" className="text-link">How models work in Xyro AI <span aria-hidden="true">→</span></Link>
      </section>

      <section className="section page-width">
        <div className="section-heading">
          <span className="eyebrow">How it works</span>
          <h2>Inside every conversation.</h2>
          <p>Three steps, the same whether you&apos;re studying, writing or building.</p>
        </div>
        <div className="more-steps">
          {conversationSteps.map((step) => (
            <article className="more-step" key={step.number}>
              <span className="more-step-number" aria-hidden="true">{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section section-quiet">
        <div className="page-width clarity-section">
          <div className="clarity-copy">
            <span className="eyebrow">Privacy &amp; security</span>
            <h2>Your work stays yours.</h2>
            <p>
              Turnstile-gated sign-in, signed server sessions, private
              file storage, and full export and delete controls — the
              security model is documented, not hand-waved.
            </p>
            <Link href="/security" className="text-link">Read the security overview <span aria-hidden="true">→</span></Link>
          </div>
          <div className="clarity-cards" aria-label="Privacy and security highlights">
            <article>
              <span className="clarity-icon" aria-hidden="true">01</span>
              <div><h3>Gated sessions</h3><p>Every API call needs your signed session cookie and a matching Firebase token.</p></div>
              <span className="clarity-state">Always on</span>
            </article>
            <article>
              <span className="clarity-icon" aria-hidden="true">02</span>
              <div><h3>Private files</h3><p>Uploads are authenticated Cloudinary assets with short-lived access links.</p></div>
              <span className="clarity-state">Always on</span>
            </article>
            <article>
              <span className="clarity-icon" aria-hidden="true">03</span>
              <div><h3>Export &amp; delete</h3><p>Download your data or erase your account from Settings whenever you like.</p></div>
              <span className="clarity-state">Your control</span>
            </article>
          </div>
        </div>
      </section>

      <section className="more-band" aria-label="Developer API">
        <div className="page-width more-dev-grid">
          <div className="more-band-copy">
            <span className="eyebrow">Developer API</span>
            <h2>Build on the same<br /><span className="gradient-text">free models.</span></h2>
            <p>
              Xyro AI has a public, OpenAI-compatible API. Activate it in
              Settings, name a key, and call the same free models the app
              uses — with a usage dashboard, per-model costs and
              per-request logs included.
            </p>
            <ul className="more-dev-points">
              <li>OpenAI-shaped requests and errors — your existing code mostly just works</li>
              <li>100,000 tokens a day on the free plan, 20 requests a minute per key</li>
              <li>Keys you name yourself, so every call is easy to trace</li>
            </ul>
            <div className="hero-actions">
              <Link href="/developers" className="button button-primary">
                Read the developer guide <span aria-hidden="true">↗</span>
              </Link>
              <Link href="/settings/developer" className="button button-quiet">
                Open the Developer tab <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
          <pre className="more-code" aria-label="Example API request">{apiSnippet}</pre>
        </div>
      </section>

      <section className="section page-width">
        <div className="section-heading">
          <span className="eyebrow">Trust &amp; control</span>
          <h2>Your chats belong to you.</h2>
          <p>
            Not as a slogan — as settings you can open right now. The{" "}
            <Link href="/privacy-center" className="text-link">privacy center</Link>{" "}
            walks through every one of them.
          </p>
        </div>
        <div className="more-trust-grid">
          <article className="more-trust-item">
            <h3>Export anytime</h3>
            <p>Download all your chats and account data as JSON or Markdown from Settings → Data controls — or export a single chat from its sidebar menu.</p>
          </article>
          <article className="more-trust-item">
            <h3>Delete anytime</h3>
            <p>One chat, every chat, your uploaded files, or your whole account. Self-serve and immediate — no support emails, no waiting periods.</p>
          </article>
          <article className="more-trust-item">
            <h3>No training on your chats</h3>
            <p>Xyro AI does not train models on your conversations. Your prompts go to OpenRouter and the selected model provider only to generate your reply.</p>
          </article>
          <article className="more-trust-item">
            <h3>Sessions you can see</h3>
            <p>Settings → Security lists every signed-in device with its recent activity. Revoke any session — or all of them — on the spot.</p>
          </article>
        </div>
      </section>

      <section className="section page-width faq-section">
        <div className="section-heading">
          <span className="eyebrow">Good to know</span>
          <h2>Clear answers<br />before you begin.</h2>
          <p>The short version is on the right; the full FAQ and help center go deeper.</p>
          <Link href="/faq" className="text-link">Read the full FAQ <span aria-hidden="true">→</span></Link>
        </div>
        <div className="faq-list">
          {faqTeaser.map((item) => (
            <details key={item.q}>
              <summary>{item.q}<span aria-hidden="true">＋</span></summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="closing-cta">
        <div className="page-width closing-cta-inner">
          <span className="eyebrow">Your next idea can start small</span>
          <h2>Ready when you are.</h2>
          <p>Create a free account, verify your email, and ask your first question.</p>
          <Link href="/sign-up" className="button button-primary">
            Get started free <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>
    </>
  );
}

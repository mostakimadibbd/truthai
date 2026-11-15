import type { Metadata } from "next";
import Link from "next/link";

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
    title: "Auto routing or pick your model",
    copy: "Use Auto (Free) and let OpenRouter route your prompt to an available free model, or pick a specific one per chat from the live catalogue. If your pick is busy, chat falls back to Auto once instead of failing.",
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
    title: "Pick a model, or don't",
    copy: "Start with Auto (Free) for zero decisions, or choose a named free model in the chat's model picker. Your default lives in Settings → General.",
  },
  {
    number: "03",
    title: "Ask, attach, iterate",
    copy: "Ask a question, attach a file for analysis, and follow up to refine the answer. Stop or regenerate a reply whenever it drifts.",
  },
];

const exampleModels = [
  { name: "Llama 3.3 70B", maker: "Meta", note: "General chat and reasoning" },
  { name: "Gemma 3 27B", maker: "Google", note: "Text and image understanding" },
  { name: "DeepSeek V3", maker: "DeepSeek", note: "Chat and code" },
  { name: "Qwen3 235B", maker: "Qwen", note: "Large general-purpose model" },
  { name: "Mistral Small 3.1", maker: "Mistral AI", note: "Text and image understanding" },
];

const faqTeaser = [
  {
    q: "Is Xyro AI really free?",
    a: "Yes. Xyro AI runs entirely on free tiers — OpenRouter's free models, Firebase's Spark plan, Cloudinary, Upstash and Vercel Hobby. There is no paid plan and nothing to buy. The trade-off is fair-use limits, which the pricing page explains honestly.",
  },
  {
    q: "Which AI models can I use?",
    a: "Any model OpenRouter currently offers for free. Auto (Free) routes each prompt to an available one; the model picker in chat lists the live free catalogue. Availability changes as providers adjust their free pools, so the in-app list is the source of truth.",
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
            <span className="landing-mock-model"><i /> Auto (Free)</span>
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
            Xyro AI only ever calls models OpenRouter lists as free. With
            Auto (Free), OpenRouter routes each prompt to an available
            free model; with the picker, you choose. Free pools change as
            providers adjust them, and free models can be busy at peak
            times — we show that honestly instead of quietly switching you
            to anything paid. A few of the free models that regularly
            appear in the catalogue:
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
          The live, current list is always in the app&apos;s model picker
          and in Settings → General. We publish no benchmark scores —
          free-model performance varies, and the honest test is trying
          your own prompt.
        </p>
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

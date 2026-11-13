import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

type Article = { title: string; intro: string; updated?: string; sections: { title: string; body: string[] }[] };

const articles: Record<string, Article> = {
  about: {
    title: "A thoughtful place to work with AI.",
    intro: "Xyro AI is being built to make useful AI feel a little more human, a little more understandable, and a lot easier to bring into your day.",
    sections: [
      { title: "Start with the work", body: ["A good tool should meet you where your work is: in a half-formed question, a document you need to understand, or an idea you want to explore.", "Xyro AI brings conversation and creative tools into one workspace. The goal is not to replace your judgment, but to help you put it to work sooner."] },
      { title: "Honest about the limits", body: ["AI systems can make mistakes, omit context, or sound certain when they are wrong. We believe a useful product makes those limits visible and gives people room to check the work.", "Xyro AI is an independent product. XyroSocial sign-in and shared-account features are not part of this standalone release."] },
      { title: "Built with care", body: ["Privacy, clear controls, and responsible use belong in the product from the start. Read our draft [privacy notice](/privacy) and [acceptable use policy](/acceptable-use) for more about the intended approach."] },
    ],
  },
  company: {
    title: "XyroBase and its products",
    intro: "XyroBase is the product studio behind a growing set of tools for thoughtful work. Xyro AI is its conversational AI workspace.",
    sections: [
      { title: "Xyro AI", body: ["Xyro AI is planned as a workspace for conversation, file understanding, image creation, and research. Product features are being introduced in stages; this site does not imply that features not yet released are available."] },
      { title: "XyroAIDetect", body: ["XyroAIDetect is the planned image-signal detector for Xyro AI-generated images. Its results are intended to be informative, not definitive proof of origin."] },
      { title: "Independent products", body: ["Each XyroBase product may have separate accounts, data systems, and terms. This Xyro AI site is standalone and does not currently share sign-in or a Firebase project with XyroSocial."] },
    ],
  },
  pricing: {
    title: "Straightforward plans, when they’re ready.",
    intro: "We’ll publish exact prices, feature availability, and usage limits before making any plan available for purchase.",
    sections: [
      { title: "Free", body: ["A free plan is planned. Its daily message and generation limits, file-size allowance, and research availability have not been set publicly yet."] },
      { title: "Pro", body: ["A paid plan is planned. Features, recurring price, billing terms, and cancellation details will be shown before checkout. No payment provider or subscription is currently connected."] },
      { title: "No surprise billing", body: ["This information site does not collect payment details or start subscriptions. If you have a question, use the [contact page](/contact)."] },
    ],
  },
  terms: {
    title: "Terms of Service",
    updated: "Draft for legal review · November 13, 2026",
    intro: "This draft describes intended terms for Xyro AI. It is not final legal advice and must be reviewed and completed by qualified counsel before the product is offered.",
    sections: [
      { title: "1. The service and eligibility", body: ["Xyro AI is an independent product. The intended minimum age is 18. Do not use the service if you are under 18. The service is not currently open for account registration or paid subscriptions.", "These draft terms are not yet a binding, complete agreement. Before launch, the operator’s legal name, contact address, effective date, and dispute process must be added."] },
      { title: "2. AI-generated output", body: ["AI output can be wrong, incomplete, biased, or out of date. You are responsible for evaluating output and verifying important information. Do not rely on it as medical, legal, financial, or other professional advice.", "You retain responsibility for how you use, publish, and act on generated output, subject to applicable law and third-party rights."] },
      { title: "3. Information processed", body: ["If the planned service is launched, it may process and store chats, uploaded files, saved memories if enabled, and image-generation records. Prompts and relevant file content may be sent to OpenRouter and selected model providers to provide requested features.", "See the [draft Privacy Notice](/privacy) for planned retention, controls, and export/deletion information. Product behavior and provider terms will be disclosed before launch."] },
      { title: "4. Images and watermarks", body: ["Images created by the planned service may carry visible and invisible Xyro AI watermark signals. These signals can be damaged, removed, or misread. You must not remove, conceal, or circumvent a watermark or provenance signal added by Xyro AI, except where applicable law grants a non-waivable right.", "No watermark or detector result guarantees that an image is AI-generated or that it has not been altered."] },
      { title: "5. Acceptable use, suspension, and termination", body: ["Use of the planned service will be subject to the [Acceptable Use Policy](/acceptable-use). We may restrict access to protect users, comply with law, or address abuse, subject to the final terms and applicable law.", "You will be able to request an export and deletion of your account data when account features launch. The final retention schedule and exceptions must be specified before launch."] },
      { title: "6. Governing law and contact", body: ["Governing law and venue have not been provided and remain to be determined. This section must be completed by counsel before these terms are used. For now, direct questions to [contact](/contact)."] },
    ],
  },
  privacy: {
    title: "Privacy Notice",
    updated: "Draft for legal review · November 13, 2026",
    intro: "This draft explains the data flows currently planned for Xyro AI. It must be checked against the implemented product, operator, providers, and applicable laws before launch.",
    sections: [
      { title: "1. Information we plan to process", body: ["If and when account features launch, this may include account identifiers, chats, files you upload, memories you choose to save, image-generation records, usage and diagnostic events, and information you send to support.", "This public information site does not currently provide account registration, chat, file upload, image generation, or payment functionality."] },
      { title: "2. AI providers", body: ["To answer a prompt or perform a requested AI feature, the planned service will send prompts and relevant context—including file content when needed—to OpenRouter and the selected model provider. Provider processing and retention are governed by their own terms and settings. The final provider list and data handling details must be disclosed before launch."] },
      { title: "3. Storage and security", body: ["The intended product architecture uses Firebase Authentication, Firestore, and Firebase Storage. Chats, uploaded files, optional memories, and generation records may be stored there. The final retention schedule, access controls, and subprocessors remain to be documented before launch.", "We plan to use safeguards appropriate to the information processed, but no system can promise perfect security."] },
      { title: "4. Memories and sensitive information", body: ["If a memory feature is offered, it will be optional and user-managed. The intended design excludes sensitive information such as health, financial, and government-identification data from saved memories. Do not submit sensitive information unless the final product explicitly supports your use case."] },
      { title: "5. Watermarks, export, and deletion", body: ["Image generation records may include provenance information. The planned product will provide account export and deletion controls; exact steps, timing, and legal or security exceptions must be confirmed before launch.", "A deletion request may not erase information already processed by an external model provider. Review the provider’s terms and the final disclosures."] },
      { title: "6. Cookies, age, and contact", body: ["This static site does not set non-essential cookies, so it does not display a cookie-consent banner. The intended minimum age for the service is 18.", "The legal operator and governing jurisdiction have not been specified. This draft must be updated with the responsible entity, privacy contact, applicable rights, and jurisdiction-specific disclosures before launch."] },
    ],
  },
  "acceptable-use": {
    title: "Acceptable Use Policy",
    updated: "Draft for legal review · November 13, 2026",
    intro: "This draft describes intended safeguards for Xyro AI. It is not a substitute for legal review and must be aligned with the final service before launch.",
    sections: [
      { title: "Use the service lawfully and responsibly", body: ["Do not use Xyro AI to violate the law, infringe others’ rights, threaten or harass people, facilitate violence, exploit minors, or create deceptive material for harmful purposes.", "Do not attempt to bypass access controls, abuse rate limits, interfere with service availability, or access another person’s data."] },
      { title: "Respect provenance signals", body: ["Do not remove, obscure, or circumvent visible or invisible watermarks that Xyro AI adds to generated images, except where applicable law provides a non-waivable right. Do not present detector output as conclusive proof of an image’s origin.", "Watermarking and detection can fail after editing, compression, cropping, screenshots, or re-generation. A missing mark does not establish that an image is human-created."] },
      { title: "Protect sensitive information", body: ["Do not provide sensitive personal information unless the final service specifically supports and protects the relevant use. The planned memory feature will not save health, financial, government-ID, or other sensitive facts."] },
      { title: "AI limitations", body: ["AI-generated answers may be inaccurate or unsafe. Review and verify output before relying on or sharing it, particularly in high-impact contexts."] },
      { title: "Reporting and enforcement", body: ["A report and enforcement process will be described before the service launches. The operator’s legal identity, governing law, and appeals process remain to be supplied and reviewed by counsel. The intended minimum age is 18."] },
    ],
  },
  help: {
    title: "A guide to Xyro AI",
    intro: "Xyro AI is not yet open for product use. This guide describes the planned features and how they are intended to work; it will be updated as features become available.",
    sections: [
      { title: "Start a conversation", body: ["When chat launches, start with a question or describe what you are trying to do. Add context, ask follow-up questions, and request a different format if the first response is not useful. AI can make mistakes, so verify important details."] },
      { title: "Work with files", body: ["File upload and analysis are planned, but are not available on this site. The intended feature supports common documents, spreadsheets, presentations, text, and images, subject to file-type and size limits. Review the final privacy notice before uploading sensitive material."] },
      { title: "Create images", body: ["Image generation and editing are planned. Generated images are intended to pass through a watermarking step before delivery. The original, unwatermarked image is not intended to be stored or sent to the browser."] },
      { title: "Use XyroAIDetect", body: ["The detector is planned to analyze images for Xyro AI signals and report a confidence-based result. It will not be a universal AI-image detector, and heavy editing or re-generation may remove the signal."] },
      { title: "Account and data controls", body: ["Google, email, and guest access are not available yet. Xyro AI is standalone; XyroSocial SSO is not configured. Account export, deletion, and other controls will be documented before account launch."] },
    ],
  },
  contact: {
    title: "Get in touch.",
    intro: "Questions about Xyro AI, its planned features, or these draft policies? We’d be glad to hear from you.",
    sections: [
      { title: "Product and general questions", body: ["Email [hello@xyro.ai](mailto:hello@xyro.ai) with a short description of what you need. Please do not include passwords, payment information, or sensitive personal data."] },
      { title: "Privacy and legal requests", body: ["The legal operator and privacy contact have not yet been confirmed. This page must be updated with a monitored privacy-request address before account features launch."] },
      { title: "Response times", body: ["This is an early product site, and a response is not guaranteed. Do not use this contact address for emergencies."] },
    ],
  },
  changelog: {
    title: "What’s changing",
    intro: "A record of meaningful product updates. We’ll add dated entries as features ship.",
    sections: [
      { title: "November 13, 2026 · Site foundation", body: ["Published the Xyro AI information site with product overview, planned-feature guide, draft legal policies, pricing information, and XyroAIDetect explainer. The authenticated application and AI features are not yet available."] },
    ],
  },
  xyroaidetect: {
    title: "A signal, not a verdict.",
    intro: "XyroAIDetect is the planned detector for images created by Xyro AI. It is not a general-purpose AI detector, and it is not available for uploads on this site.",
    sections: [
      { title: "What it is designed to look for", body: ["The intended design combines multiple signals: a visible Xyro AI label, an invisible image watermark, and—where available—a match against a registry of generated images. The registry would use a perceptual fingerprint to help find related images even when some signals are damaged.", "Detection results may include a verdict, confidence, matched signal layers, and a region map. Exact behavior depends on the implementation and will be described when the detector is available."] },
      { title: "What a result means", body: ["A match may indicate that an image contains a signal associated with Xyro AI. It is not proof of who created, owns, or edited the image. A non-match does not prove that an image is human-created or that it has never been generated by AI.", "Compression, cropping, resizing, screenshots, brightness or contrast changes, and other edits can weaken or remove signals. AI re-generation may remove them entirely."] },
      { title: "Privacy and availability", body: ["The planned detector is intended to process uploads in memory, delete them promptly, and apply rate limits. Upload-based detection is not enabled on this site; no image upload is accepted here. The exact retention and processing behavior will be published before launch."] },
      { title: "Research and limitations", body: ["Robustness depends on image format, resolution, transformations, and implementation. Detection should be one input among many, never a sole basis for consequential decisions."] },
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(articles).map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = articles[slug];
  if (!article) return {};
  return {
    title: article.title,
    description: article.intro,
    openGraph: { title: article.title, description: article.intro, type: "article" },
  };
}

function renderText(text: string) {
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(text)) !== null) {
    const [markdown, label, href] = match;
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    parts.push(
      href.startsWith("/") ? (
        <Link key={match.index} href={href}>{label}</Link>
      ) : (
        <a key={match.index} href={href}>{label}</a>
      ),
    );
    cursor = match.index + markdown.length;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export default async function InformationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = articles[slug];
  if (!article) notFound();

  return (
    <article className="article page-width">
      <Link href="/" className="back-link">← Back to Xyro AI</Link>
      <header className="article-header">
        <span className="eyebrow">Xyro AI</span>
        <h1>{article.title}</h1>
        <p>{article.intro}</p>
        {article.updated && <span className="article-date">{article.updated}</span>}
      </header>
      <div className="article-body">
        {article.sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.body.map((paragraph, index) => (
              <p key={index}>{renderText(paragraph)}</p>
            ))}
          </section>
        ))}
      </div>
      <div className="article-contact">
        <span>Still have a question?</span>
        <Link href="/contact" className="text-link">Get in touch <span aria-hidden="true">→</span></Link>
      </div>
    </article>
  );
}

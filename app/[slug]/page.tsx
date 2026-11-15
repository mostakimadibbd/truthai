import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { articles } from "@/lib/public-pages";

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

/** Paragraphs, with consecutive "- " lines grouped into a bullet list. */
function renderBody(body: string[]) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length === 0) return;
    const items = list;
    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {items.map((item, index) => (
          <li key={index}>{renderText(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const paragraph of body) {
    if (paragraph.startsWith("- ")) {
      list.push(paragraph.slice(2));
    } else {
      flushList();
      blocks.push(<p key={`p-${blocks.length}`}>{renderText(paragraph)}</p>);
    }
  }
  flushList();
  return blocks;
}

export default async function InformationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = articles[slug];
  if (!article) notFound();
  const isHelpArticle = slug.startsWith("help-");

  return (
    <article className="article page-width">
      <Link href={isHelpArticle ? "/help" : "/"} className="back-link">
        ← Back to {isHelpArticle ? "help center" : "Xyro AI"}
      </Link>
      <header className="article-header">
        <span className="eyebrow">Xyro AI</span>
        <h1>{article.title}</h1>
        <p>{renderText(article.intro)}</p>
        {article.updated && <span className="article-date">{article.updated}</span>}
      </header>

      {article.cards && (
        <nav className="article-cards" aria-label="Help topics">
          {article.cards.map((card) => (
            <Link key={card.href} href={card.href} className="article-card">
              <strong>{card.title}</strong>
              <span>{card.blurb}</span>
              <span className="article-card-arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </nav>
      )}

      {article.faqs && (
        <div className="faq-list article-faqs">
          {article.faqs.map((item) => (
            <details key={item.q}>
              <summary>{item.q}<span aria-hidden="true">＋</span></summary>
              <p>{renderText(item.a)}</p>
            </details>
          ))}
        </div>
      )}

      <div className="article-body">
        {article.sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {renderBody(section.body)}
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

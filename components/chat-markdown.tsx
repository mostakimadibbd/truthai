"use client";

import {
  Children,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

// Assistant-message markdown (Phase 5). GitHub-flavoured markdown with
// a sanitize pass (rehype-sanitize's default GitHub schema: no raw
// HTML, no scripts, no event handlers, and the language-* class on
// code blocks is preserved for the label). Links are forced to open
// safely in a new tab, and fenced code blocks get a header with the
// language name and a Copy button.

function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    return extractText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

function CodeBlock({ language, text }: { language: string; text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="chat-code-block">
      <div className="chat-code-header">
        <span>{language}</span>
        <button type="button" onClick={() => void copy()} aria-label="Copy code">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  );
}

export default function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          pre({ children }) {
            const codeElement = Children.toArray(children).find(isValidElement) as
              | ReactElement<{ className?: string; children?: ReactNode }>
              | undefined;
            const className = codeElement?.props.className ?? "";
            const language =
              /language-([\w-]+)/.exec(className)?.[1] ?? "code";
            const codeText = extractText(codeElement?.props.children).replace(
              /\n$/,
              "",
            );
            return <CodeBlock language={language} text={codeText} />;
          },
          code({ children }) {
            // Block code never reaches here (the pre override renders
            // it), so this is inline code only.
            return <code className="chat-inline-code">{children}</code>;
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          table({ children }) {
            return (
              <div className="chat-table-wrap">
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

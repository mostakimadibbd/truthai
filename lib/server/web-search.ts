import { lookup } from "node:dns/promises";

// Web search + page reading for chat (owner request, 2026-11-16:
// "implement web search for recent data like ChatGPT").
//
// Free-tier reality check, verified live from the server side:
// DuckDuckGo (html + lite) answers datacenter IPs with its 202 bot
// challenge and Brave Search with 429, while Bing's results page is
// served and parseable. So search reads Bing's public results page
// (no API key, no billing) and degrades to "no results" on any
// failure — chat must never break because search did.
//
// Page reading fetches user-pasted links with SSRF guards: only
// http/https, DNS results are checked against private/reserved
// ranges, every redirect hop is re-validated, and downloads are
// size- and time-capped. (Residual risk: DNS rebinding between the
// check and the fetch — accepted and documented in SECURITY.md.)

export type WebSource = { title: string; url: string };

export type WebSearchResult = WebSource & { snippet: string };

const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10) || 32),
    );
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Bing wraps result links in a redirect with the target base64url-encoded in `u`. */
function decodeBingUrl(href: string): string {
  try {
    const parsed = new URL(decodeEntities(href));
    const u = parsed.searchParams.get("u");
    if (u && u.startsWith("a1")) {
      const decoded = Buffer.from(u.slice(2), "base64url").toString("utf8");
      if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
        return decoded;
      }
    }
  } catch {
    // Fall through to the raw href.
  }
  return decodeEntities(href);
}

/** Parses Bing's results HTML into structured results (exported for tests). */
export function parseBingResults(html: string, count = 6): WebSearchResult[] {
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? [];
  const results: WebSearchResult[] = [];
  for (const block of blocks) {
    const link = /<h2>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link) continue;
    const url = decodeBingUrl(link[1]);
    if (!/^https?:\/\//.test(url)) continue;
    const snippetMatch = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block);
    results.push({
      title: stripTags(link[2]).slice(0, 160) || url,
      url,
      snippet: snippetMatch ? stripTags(snippetMatch[1]).slice(0, 320) : "",
    });
    if (results.length >= count) break;
  }
  return results;
}

export async function searchWeb(
  query: string,
  count = 6,
): Promise<WebSearchResult[]> {
  const q = query.trim().slice(0, 300);
  if (!q) return [];
  try {
    const response = await fetch(
      `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en`,
      {
        headers: { "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(9000),
        cache: "no-store",
      },
    );
    if (!response.ok) return [];
    return parseBingResults(await response.text(), count);
  } catch {
    return [];
  }
}

export function extractUrls(text: string, max = 2): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [];
  const unique = [...new Set(matches.map((url) => url.replace(/[.,;:!?]+$/, "")))];
  return unique.slice(0, max);
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fe80:") ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower === "::"
    );
  }
  const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some(Number.isNaN)) return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new Error("Local hosts are not readable.");
  }
  // If the host is already an IP literal, check it directly.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) {
    if (isPrivateIp(hostname)) throw new Error("Private address.");
    return;
  }
  const records = await lookup(hostname, { all: true });
  if (!records.length || records.some((record) => isPrivateIp(record.address))) {
    throw new Error("Host resolves to a private address.");
  }
}

export async function fetchPageText(url: string): Promise<string | null> {
  let current = url;
  try {
    for (let hop = 0; hop <= 3; hop++) {
      const parsed = new URL(current);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      await assertPublicHost(parsed.hostname);
      const response = await fetch(current, {
        headers: { "User-Agent": BROWSER_UA },
        redirect: "manual",
        signal: AbortSignal.timeout(9000),
        cache: "no-store",
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || hop === 3) return null;
        current = new URL(location, current).toString();
        continue;
      }
      if (!response.ok) return null;
      const contentType = response.headers.get("content-type") ?? "";
      if (!/text\/html|text\/plain/.test(contentType)) return null;
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 1_500_000) return null;
      const html = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
      if (contentType.includes("text/plain")) {
        return html.replace(/\s+/g, " ").trim().slice(0, 6000) || null;
      }
      const withoutScripts = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
      const text = stripTags(withoutScripts).slice(0, 6000);
      return text.length > 120 ? text : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Builds the web context system block for one chat turn: search
 * results when the user turned web search on, plus the readable
 * text of any links in the message. Returns the sources to show
 * under the reply. Never throws.
 */
export async function buildWebContext(options: {
  searchEnabled: boolean;
  message: string;
}): Promise<{ context: string | null; sources: WebSource[] }> {
  const sources: WebSource[] = [];
  const sections: string[] = [];
  const urls = extractUrls(options.message);

  const [results, pageTexts] = await Promise.all([
    options.searchEnabled
      ? searchWeb(options.message.replace(/https?:\/\/\S+/g, "").trim() || options.message)
      : Promise.resolve([] as WebSearchResult[]),
    Promise.all(urls.map(async (url) => ({ url, text: await fetchPageText(url) }))),
  ]);

  if (results.length) {
    const lines = results.map((result, index) => {
      sources.push({ title: result.title, url: result.url });
      return `[${index + 1}] ${result.title}\n${result.url}\n${result.snippet}`;
    });
    sections.push(`WEB SEARCH RESULTS (retrieved just now):\n${lines.join("\n\n")}`);
  }

  for (const page of pageTexts) {
    if (!page.text) continue;
    const index = sources.length + 1;
    sources.push({ title: page.url, url: page.url });
    sections.push(
      `CONTENT OF THE LINK THE USER SHARED [${index}] (${page.url}):\n${page.text}`,
    );
  }

  if (!sections.length) {
    return { context: null, sources: [] };
  }

  const context = [
    "You have live web access for this reply. The material below was retrieved from the web just now.",
    "Use it for anything time-sensitive (news, prices, schedules, current facts) and prefer it over your training knowledge when they conflict.",
    "Cite the numbered sources inline like [1] or [2] next to the claims they support, and keep citations honest — only cite a source for what its text actually says.",
    "",
    ...sections,
  ].join("\n");

  return { context, sources };
}

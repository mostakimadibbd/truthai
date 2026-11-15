import { lookup } from "node:dns/promises";

// Web search + page reading for chat (owner requests, 2026-11-16:
// "implement web search for recent data like ChatGPT", then "make
// sure search works even when the user doesn't select the web
// search button... if the user requests search or research the AI
// can use websearch... implement smart think").
//
// Provider reality (verified live): search engines treat
// datacenter IPs inconsistently — the page that works from one
// network is challenged from another (the first production failure
// was Bing's HTML page being blocked from the host's egress while
// it worked in development). So search is a CHAIN of independent
// free sources, tried in order until one returns results:
//   1. Bing RSS (official feed output of Bing search)
//   2. Bing HTML results page
//   3. Google News RSS (promoted to first for news-intent queries)
//   4. DuckDuckGo Instant Answer API
// Every attempt is logged by the caller (searchEvents collection),
// so a silent provider block is visible in the data, not a mystery.
// Chat never breaks because search did: worst case there is no web
// context and the model is told plainly that search came back empty.
//
// Page reading fetches links with SSRF guards: only http/https,
// DNS results are checked against private/reserved ranges, every
// redirect hop is re-validated, and downloads are size- and
// time-capped. (Residual risk: DNS rebinding between the check and
// the fetch — accepted and documented in SECURITY.md.)

export type WebSource = { title: string; url: string };

export type WebSearchResult = WebSource & { snippet: string };

export type SearchOutcome = {
  results: WebSearchResult[];
  /** Which provider answered: "bing-rss" | "bing" | "google-news" | "ddg" | null. */
  provider: string | null;
};

const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const PROVIDER_TIMEOUT_MS = 6_000;
const CHAIN_BUDGET_MS = 12_000;
const MAX_CONTEXT_CHARS = 9_000;

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

function decodeXml(text: string): string {
  return decodeEntities(
    text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"),
  ).trim();
}

/* ------------------------------ intent ------------------------------ */

const EXPLICIT_SEARCH =
  /\b(search|google|look ?up|browse|research|find online|check online|verify online|search the web|on the web|online)\b/i;
const RECENCY =
  /\b(latest|recent|breaking|today|tonight|yesterday|tomorrow|news|headlines?|live score|weather|forecast|price of|stock price|exchange rate|who won|winner|results? of|schedule|when is|when does|release date|launched|announced|trending|happening|this week|this month|this year)\b/i;
const RESEARCH =
  /\b(research|analyse|analyze|analysis|compare|comparison|deep dive|investigate|report on|review of|pros and cons)\b/i;

/**
 * "Smart think" trigger: does this message need live web data even
 * though the user didn't flip the search toggle? Explicit asks and
 * recency/live-data signals say yes. Creative and timeless requests
 * ("write a poem", "explain recursion") say no.
 */
export function hasSearchIntent(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8) return false;
  if (EXPLICIT_SEARCH.test(trimmed)) return true;
  if (RECENCY.test(trimmed)) return true;
  // A question naming the current or last year is almost always
  // asking about current state.
  const year = new Date().getUTCFullYear();
  if (
    trimmed.includes("?") &&
    (trimmed.includes(String(year)) || trimmed.includes(String(year - 1)))
  ) {
    return true;
  }
  return false;
}

export function hasResearchIntent(text: string): boolean {
  return RESEARCH.test(text);
}

export function hasNewsIntent(text: string): boolean {
  return /\b(news|headlines?|breaking|latest|today|trending)\b/i.test(text);
}

/** Strips URLs and "search for..." style imperatives to form the query. */
export function cleanSearchQuery(message: string): string {
  let query = message.replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
  query = query.replace(
    /^(please\s+)?(can you\s+)?(search( the web)?( for)?|google( for)?|look up|find( me| out)?|research|browse( the web)?( for)?|check online( for)?)\s+/i,
    "",
  );
  query = query.replace(/\s+(on the web|online|on web)\s*$/i, "");
  return (query || message).slice(0, 300);
}

/* ------------------------------ providers ------------------------------ */

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

/** Parses RSS items (Bing RSS + Google News RSS share the shape). */
export function parseRssResults(xml: string, count = 6): WebSearchResult[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const results: WebSearchResult[] = [];
  for (const item of items) {
    const title = /<title>([\s\S]*?)<\/title>/.exec(item)?.[1];
    const link = /<link>([\s\S]*?)<\/link>/.exec(item)?.[1];
    const description = /<description>([\s\S]*?)<\/description>/.exec(item)?.[1];
    if (!title || !link) continue;
    const url = decodeXml(link);
    if (!/^https?:\/\//.test(url)) continue;
    results.push({
      title: stripTags(decodeXml(title)).slice(0, 160),
      url,
      snippet: description ? stripTags(decodeXml(description)).slice(0, 320) : "",
    });
    if (results.length >= count) break;
  }
  return results;
}

/** Parses a DuckDuckGo Instant Answer JSON payload. */
export function parseDdgInstant(payload: unknown, count = 6): WebSearchResult[] {
  if (typeof payload !== "object" || payload === null) return [];
  const data = payload as {
    AbstractText?: unknown;
    AbstractURL?: unknown;
    AbstractSource?: unknown;
    RelatedTopics?: unknown;
  };
  const results: WebSearchResult[] = [];
  if (
    typeof data.AbstractText === "string" &&
    data.AbstractText.length > 20 &&
    typeof data.AbstractURL === "string" &&
    /^https?:\/\//.test(data.AbstractURL)
  ) {
    results.push({
      title:
        typeof data.AbstractSource === "string" && data.AbstractSource
          ? data.AbstractSource
          : data.AbstractURL,
      url: data.AbstractURL,
      snippet: data.AbstractText.slice(0, 320),
    });
  }
  const topics = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
  const flat: { Text?: unknown; FirstURL?: unknown }[] = [];
  for (const topic of topics) {
    if (typeof topic !== "object" || topic === null) continue;
    const entry = topic as { Text?: unknown; FirstURL?: unknown; Topics?: unknown };
    if (Array.isArray(entry.Topics)) {
      flat.push(...(entry.Topics as { Text?: unknown; FirstURL?: unknown }[]));
    } else {
      flat.push(entry);
    }
  }
  for (const topic of flat) {
    if (
      typeof topic.Text === "string" &&
      typeof topic.FirstURL === "string" &&
      /^https?:\/\//.test(topic.FirstURL)
    ) {
      results.push({
        title: topic.Text.slice(0, 160),
        url: topic.FirstURL,
        snippet: topic.Text.slice(0, 320),
      });
    }
    if (results.length >= count) break;
  }
  return results.slice(0, count);
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

const PROVIDERS: {
  id: string;
  run: (query: string) => Promise<WebSearchResult[]>;
}[] = [
  {
    id: "bing-rss",
    run: async (query) => {
      const xml = await fetchText(
        `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`,
      );
      return xml ? parseRssResults(xml) : [];
    },
  },
  {
    id: "bing",
    run: async (query) => {
      const html = await fetchText(
        `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`,
      );
      return html ? parseBingResults(html) : [];
    },
  },
  {
    id: "google-news",
    run: async (query) => {
      const xml = await fetchText(
        `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
      );
      return xml ? parseRssResults(xml) : [];
    },
  },
  {
    id: "ddg",
    run: async (query) => {
      const text = await fetchText(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      );
      if (!text) return [];
      try {
        return parseDdgInstant(JSON.parse(text));
      } catch {
        return [];
      }
    },
  },
];

/**
 * Runs the provider chain until one returns results. News-intent
 * queries try Google News first (freshest headlines); everything
 * else starts with the RSS/HTML web indexes. Bounded by a total
 * time budget so a bad network day can't stall the reply.
 */
export async function searchWeb(query: string): Promise<SearchOutcome> {
  const q = query.trim().slice(0, 300);
  if (!q) return { results: [], provider: null };
  const startedAt = Date.now();
  const ordered = hasNewsIntent(q)
    ? [
        PROVIDERS.find((provider) => provider.id === "google-news")!,
        ...PROVIDERS.filter((provider) => provider.id !== "google-news"),
      ]
    : PROVIDERS;
  for (const provider of ordered) {
    if (Date.now() - startedAt > CHAIN_BUDGET_MS) break;
    const results = await provider.run(q).catch(() => [] as WebSearchResult[]);
    if (results.length) {
      return { results, provider: provider.id };
    }
  }
  return { results: [], provider: null };
}

export function extractUrls(text: string, max = 2): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [];
  const unique = [...new Set(matches.map((url) => url.replace(/[.,;:!?]+$/, "")))];
  return unique.slice(0, max);
}

/* ------------------------------ page reading ------------------------------ */

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

export async function fetchPageText(
  url: string,
  maxChars = 4000,
): Promise<string | null> {
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
        return html.replace(/\s+/g, " ").trim().slice(0, maxChars) || null;
      }
      const withoutScripts = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
      const text = stripTags(withoutScripts).slice(0, maxChars);
      return text.length > 120 ? text : null;
    }
    return null;
  } catch {
    return null;
  }
}

/* ------------------------------ context ------------------------------ */

export type WebContextResult = {
  context: string | null;
  sources: WebSource[];
  /** True when a search was run (toggle or auto-detected). */
  searched: boolean;
  provider: string | null;
  resultCount: number;
  query: string;
};

/**
 * Builds the web context system block for one chat turn. Runs a
 * search when asked (toggle/auto), reads any links in the message,
 * and — for research-style asks — reads the top results in full so
 * the model reasons over real text, not just snippets. The whole
 * block is hard-capped so it can never push the model request over
 * a context limit. Never throws.
 */
export async function buildWebContext(options: {
  searchEnabled: boolean;
  message: string;
}): Promise<WebContextResult> {
  const sources: WebSource[] = [];
  const sections: string[] = [];
  const urls = extractUrls(options.message);
  const query = cleanSearchQuery(options.message);
  const research = hasResearchIntent(options.message);

  const [outcome, pageTexts] = await Promise.all([
    options.searchEnabled
      ? searchWeb(query)
      : Promise.resolve({ results: [], provider: null } as SearchOutcome),
    Promise.all(urls.map(async (url) => ({ url, text: await fetchPageText(url) }))),
  ]);

  const results = outcome.results;
  if (results.length) {
    const lines = results.map((result, index) => {
      sources.push({ title: result.title, url: result.url });
      return `[${index + 1}] ${result.title}\n${result.url}\n${result.snippet}`;
    });
    sections.push(`WEB SEARCH RESULTS (retrieved just now):\n${lines.join("\n\n")}`);

    if (research) {
      const deep = await Promise.all(
        results
          .slice(0, 2)
          .map(async (result) => ({ result, text: await fetchPageText(result.url) })),
      );
      for (const page of deep) {
        if (!page.text) continue;
        const index = results.indexOf(page.result) + 1;
        sections.push(
          `FULL TEXT OF SOURCE [${index}] (${page.result.url}):\n${page.text}`,
        );
      }
    }
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
    return {
      context: null,
      sources: [],
      searched: options.searchEnabled,
      provider: outcome.provider,
      resultCount: 0,
      query,
    };
  }

  const context = [
    "You have live web access for this reply. The material below was retrieved from the web just now.",
    "Use it for anything time-sensitive (news, prices, schedules, current facts) and prefer it over your training knowledge when they conflict.",
    "Think carefully across the sources before answering: compare what they agree on, note disagreements or uncertainty, and date any fact that could change.",
    "Cite the numbered sources inline like [1] or [2] next to the claims they support, and keep citations honest — only cite a source for what its text actually says.",
    "",
    ...sections,
  ]
    .join("\n")
    .slice(0, MAX_CONTEXT_CHARS);

  return {
    context,
    sources,
    searched: options.searchEnabled,
    provider: outcome.provider,
    resultCount: results.length,
    query,
  };
}

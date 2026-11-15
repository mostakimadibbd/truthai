import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanSearchQuery,
  extractUrls,
  hasSearchIntent,
  parseBingResults,
  parseDdgInstant,
  parseHnResults,
  parseRssResults,
  parseWikipediaResults,
  simplifyQuery,
} from "../lib/server/web-search.ts";

test("extractUrls dedupes, trims trailing punctuation, and caps", () => {
  assert.deepEqual(
    extractUrls("see https://example.com/a, then http://foo.bar/x. and https://example.com/a again"),
    ["https://example.com/a", "http://foo.bar/x"],
  );
  assert.deepEqual(extractUrls("no links here"), []);
  assert.equal(extractUrls("https://a.com https://b.com https://c.com", 2).length, 2);
});

test("parseBingResults decodes redirect targets and snippets", () => {
  const target = "https://example.com/story";
  const encoded = Buffer.from(target, "utf8").toString("base64url");
  const html = `
    <li class="b_algo">
      <h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1${encoded}" target="_blank">Example &amp; Story</a></h2>
      <div class="b_caption"><p>Some <b>snippet</b> text.</p></div>
    </li>
    <li class="b_algo"><div>no result link here</div></li>`;
  const results = parseBingResults(html);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, target);
  assert.equal(results[0].title, "Example & Story");
  assert.equal(results[0].snippet, "Some snippet text.");
});

test("parseBingResults returns [] for a challenge or empty page", () => {
  assert.deepEqual(parseBingResults("<html><body>captcha</body></html>"), []);
});

test("parseRssResults reads Bing/Google News items with entities decoded", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>Big &amp; Bold Launch</title><link>https://example.com/a</link><description><![CDATA[Something <b>new</b> shipped]]></description></item>
    <item><title>Second Story</title><link>https://example.org/b</link><description>Plain text</description></item>
    <item><title>No link here</title><description>skip me</description></item>
  </channel></rss>`;
  const results = parseRssResults(xml);
  assert.equal(results.length, 2);
  assert.equal(results[0].title, "Big & Bold Launch");
  assert.equal(results[0].url, "https://example.com/a");
  assert.match(results[0].snippet, /Something new shipped/);
});

test("parseDdgInstant uses the abstract and flattens related topics", () => {
  const results = parseDdgInstant({
    AbstractText: "An abstract that is comfortably longer than twenty characters.",
    AbstractURL: "https://en.wikipedia.org/wiki/Example",
    AbstractSource: "Wikipedia",
    RelatedTopics: [
      { Text: "Topic one", FirstURL: "https://duckduckgo.com/1" },
      { Topics: [{ Text: "Nested topic", FirstURL: "https://duckduckgo.com/2" }] },
      { Text: "No URL" },
    ],
  });
  assert.equal(results[0].title, "Wikipedia");
  assert.equal(results.length, 3);
});

test("hasSearchIntent catches live-data asks and skips timeless ones", () => {
  assert.equal(hasSearchIntent("What is the latest iPhone price?"), true);
  assert.equal(hasSearchIntent("Search for today's cricket score"), true);
  assert.equal(hasSearchIntent("Research the best laptops this year"), true);
  assert.equal(hasSearchIntent("Write a poem about the sea"), false);
  assert.equal(hasSearchIntent("Explain recursion with an example"), false);
  assert.equal(hasSearchIntent("hi"), false);
});

test("cleanSearchQuery strips imperatives and links", () => {
  assert.equal(cleanSearchQuery("Search for the latest AI news"), "the latest AI news");
  assert.equal(cleanSearchQuery("Please research electric cars online"), "electric cars");
  assert.match(cleanSearchQuery("What happened https://example.com/x today"), /What happened\s+today/);
});

test("parseWikipediaResults maps the opensearch tuple shape", () => {
  const results = parseWikipediaResults([
    "query",
    ["Alpha", "Beta"],
    ["First description", ""],
    ["https://en.wikipedia.org/wiki/Alpha", "https://en.wikipedia.org/wiki/Beta"],
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0].snippet, "First description");
  assert.equal(results[1].url, "https://en.wikipedia.org/wiki/Beta");
});

test("parseHnResults prefers story fields and falls back to the HN item page", () => {
  const results = parseHnResults({
    hits: [
      { title: "Launch post", url: "https://example.com/launch", objectID: "1" },
      { story_title: "Ask HN: things", objectID: "42" },
      { objectID: "3" },
    ],
  });
  assert.equal(results.length, 2);
  assert.equal(results[1].url, "https://news.ycombinator.com/item?id=42");
});

test("simplifyQuery strips question scaffolding", () => {
  assert.equal(simplifyQuery("What is the latest iPhone price?"), "latest iPhone price");
});

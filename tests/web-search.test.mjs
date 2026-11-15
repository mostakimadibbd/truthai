import { test } from "node:test";
import assert from "node:assert/strict";
import { extractUrls, parseBingResults } from "../lib/server/web-search.ts";

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

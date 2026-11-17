import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "API documentation — Xyro AI Developers",
  description:
    "Full reference for the Xyro AI public API: authentication, chat completions, models, limits and errors, with cURL, JavaScript and Python examples.",
  openGraph: {
    title: "API documentation — Xyro AI Developers",
    description:
      "Full reference for the Xyro AI public API: authentication, chat completions, models, limits and errors, with cURL, JavaScript and Python examples.",
    type: "article",
  },
};

const BASE = "https://truthai-six.vercel.app/api/v1";

function Code({ children }: { children: string }) {
  return (
    <pre className="docs-code">
      <code>{children}</code>
    </pre>
  );
}

export default function ApiDocsPage() {
  return (
    <article className="article page-width">
      <Link href="/developers" className="back-link">
        ← Back to Developers
      </Link>
      <header className="article-header">
        <span className="eyebrow">Xyro AI Developers</span>
        <h1>API documentation</h1>
        <p>
          The complete reference for the Xyro AI public API — an
          OpenAI-compatible HTTP API over the same free models the
          app uses. Activate developer access in Settings →
          Developer to get a key.
        </p>
        <span className="article-date">Reference current as of November 2026</span>
      </header>

      <div className="article-body">
        <section>
          <h2>Authentication</h2>
          <p>
            Every request carries your API key as a Bearer token.
            Keys look like <code>xyro_sk_live_…</code>, are shown
            once at creation, and are stored on our side only as a
            SHA-256 hash — a lost key cannot be recovered, only
            revoked and replaced. You can hold up to 5 active keys;
            each key has a name you choose, and revoking a key
            takes effect immediately.
          </p>
          <Code>{`Authorization: Bearer xyro_sk_live_YOUR_KEY`}</Code>
          <p>
            Keep keys on a server, never in browser or mobile code.
            Requests without a valid key fail with{" "}
            <code>401 invalid_api_key</code>. Keys belonging to a
            disabled account fail with <code>403 account_disabled</code>,
            and keys on an account whose email is not yet verified
            fail with <code>403 email_not_verified</code>.
          </p>
        </section>

        <section>
          <h2>Create a chat completion</h2>
          <p>
            <code>POST {BASE}/chat/completions</code>
          </p>
          <p>
            Send a conversation, get one completion. The request
            and response shapes follow the OpenAI chat completions
            API, so most OpenAI client libraries work by changing
            the base URL and key.
          </p>
          <p>Request fields:</p>
          <ul>
            <li>
              <code>messages</code> (required) — an array of{" "}
              <code>{"{ role, content }"}</code> objects; roles are{" "}
              <code>system</code>, <code>user</code> and{" "}
              <code>assistant</code>. At most 50 messages per call.
            </li>
            <li>
              <code>model</code> (optional) — a model id from{" "}
              <code>GET /models</code>, or a mode id:{" "}
              <code>fast</code>, <code>thinking</code> or{" "}
              <code>lightweight</code>. Defaults to Auto, which
              routes across the free models.
            </li>
            <li>
              <code>max_tokens</code> (optional) — cap on the
              completion length, up to 4096.
            </li>
            <li>
              Streaming (<code>stream</code>) is not supported yet;
              calls always return the complete reply at once.
            </li>
          </ul>
          <p>cURL:</p>
          <Code>{`curl ${BASE}/chat/completions \\
  -H "Authorization: Bearer xyro_sk_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "fast",
    "messages": [
      {"role": "system", "content": "You are a concise assistant."},
      {"role": "user", "content": "Explain photosynthesis in two sentences."}
    ]
  }'`}</Code>
          <p>JavaScript (fetch):</p>
          <Code>{`const response = await fetch("${BASE}/chat/completions", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.XYRO_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "fast",
    messages: [{ role: "user", content: "Explain photosynthesis in two sentences." }],
  }),
});

const data = await response.json();
console.log(data.choices[0].message.content);
console.log(data.usage); // { prompt_tokens, completion_tokens, total_tokens }`}</Code>
          <p>Python (requests):</p>
          <Code>{`import os
import requests

response = requests.post(
    "${BASE}/chat/completions",
    headers={"Authorization": f"Bearer {os.environ['XYRO_API_KEY']}"},
    json={
        "model": "fast",
        "messages": [
            {"role": "user", "content": "Explain photosynthesis in two sentences."}
        ],
    },
    timeout=120,
)
data = response.json()
print(data["choices"][0]["message"]["content"])
print(data["usage"])`}</Code>
          <p>Example response:</p>
          <Code>{`{
  "id": "chatcmpl-…",
  "object": "chat.completion",
  "created": 1763000000,
  "model": "fast",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Photosynthesis is how plants turn sunlight, water and carbon dioxide into oxygen and glucose…"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 21, "completion_tokens": 42, "total_tokens": 63 }
}`}</Code>
        </section>

        <section>
          <h2>List models</h2>
          <p>
            <code>GET {BASE}/models</code>
          </p>
          <p>
            Returns the models and modes your key can use right
            now, in the OpenAI list shape. Availability follows the
            free upstream providers, so the list can change; fetch
            it rather than hard-coding ids.
          </p>
          <Code>{`curl ${BASE}/models \\
  -H "Authorization: Bearer xyro_sk_live_YOUR_KEY"

{
  "object": "list",
  "data": [
    { "id": "fast", "object": "model", "owned_by": "xyro" },
    { "id": "thinking", "object": "model", "owned_by": "xyro" },
    { "id": "lightweight", "object": "model", "owned_by": "xyro" }
  ]
}`}</Code>
        </section>

        <section>
          <h2>Limits</h2>
          <ul>
            <li>Free plan: 100,000 tokens per day per account (prompt + completion), resetting at midnight UTC.</li>
            <li>20 requests per minute per API key.</li>
            <li>At most 50 messages and <code>max_tokens</code> up to 4096 per call.</li>
            <li>Up to 5 active API keys per account.</li>
          </ul>
          <p>
            Hitting the daily cap returns{" "}
            <code>429 daily_token_limit_exceeded</code>; exceeding
            the per-minute rate returns{" "}
            <code>429 rate_limit_exceeded</code>. Wait for the
            window to reset rather than retrying in a tight loop.
            Every call is metered and appears in Settings →
            Developer (usage, per-request activity and the model
            that answered), as disclosed in the{" "}
            <Link href="/privacy">privacy policy</Link>.
          </p>
        </section>

        <section>
          <h2>Errors</h2>
          <p>
            Errors use the OpenAI shape:{" "}
            <code>{`{ "error": { "message", "type", "code" } }`}</code>.
            The codes you can receive:
          </p>
          <ul>
            <li><code>401 invalid_api_key</code> — the key is missing, malformed, revoked or unknown.</li>
            <li><code>403 account_disabled</code> — the owning account is disabled.</li>
            <li><code>403 email_not_verified</code> — verify the account email, then retry.</li>
            <li><code>400 invalid_request</code> — the body failed validation (missing messages, too many messages, max_tokens out of range).</li>
            <li><code>429 rate_limit_exceeded</code> — more than 20 requests in a minute on this key.</li>
            <li><code>429 daily_token_limit_exceeded</code> — the free plan's 100,000 daily tokens are used up.</li>
            <li><code>429 model_busy</code> / <code>502 model_unavailable</code> — the free upstream models are saturated or down; retry with backoff, or try another mode.</li>
            <li><code>503 api_unavailable</code> — the API itself is temporarily unavailable.</li>
          </ul>
          <p>
            The <Link href="/api-terms">API terms</Link> and{" "}
            <Link href="/acceptable-use">acceptable use policy</Link>{" "}
            govern use of the API; the{" "}
            <Link href="/developers">developers page</Link> covers
            activation and the console.
          </p>
        </section>
      </div>
    </article>
  );
}

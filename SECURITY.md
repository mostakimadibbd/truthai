# Xyro AI — Security Notes

## How sign-in security works

Turnstile gates the **server session**, not just the form. After a
successful sign-in, sign-up, Google exchange, or silent renewal, the
server sets a signed, HttpOnly session cookie (`__Host-xyro_session`,
HS256 JWT, 30-day sliding / 90-day absolute expiry). Every product API
(`/api/chat`, `/api/chats*`, `/api/uploads/*`, and later settings /
export / account routes) requires **both**:

1. the session cookie, and
2. a Firebase ID token whose `uid` matches the cookie's `uid`.

Sessions can be revoked server-side (Redis keys `revoked:{sid}` and
`validAfter:{uid}`, checked with a 30-second in-memory cache).

Auth routes (`/api/auth/*`) additionally require a same-origin
`Origin` header, `Content-Type: application/json`, and the
`X-Requested-With: xyro` header, and are rate-limited per IP / IP+email
(Upstash Redis, free tier).

## Residual risk: Firebase's public endpoints

Firebase's public authentication endpoints remain callable with the
public web API key — that is how Firebase is designed, and the web API
key is not a secret. A bot can therefore call Firebase directly (create
accounts, request password resets) **without ever loading our forms or
passing Turnstile**. This is accepted residual risk, mitigated by:

- **No product access without the session cookie.** Direct Firebase
  access yields no session, and every product API returns 401 without
  one. Turnstile is what gates the session.
- **Verified email is required** before chat/upload APIs respond.
- **Per-route rate limits** on the server (auth, chat, uploads), plus
  Firebase's own built-in throttling on its public endpoints.
- Server-side sign-in for email/password, so password attempts against
  our product pass through Turnstile and our rate limits.

### Required console hardening (manual steps)

1. In Google Cloud Console → APIs & Services → Credentials, restrict
   the browser API key:
   - **Application restrictions:** HTTP referrers — only this site's
     origins (production domain, its `vercel.app` alias, localhost for
     development).
   - **API restrictions:** only the Identity Toolkit API and the
     Firebase APIs the web app uses.
2. In the Firebase Console → Authentication → Settings, if the option
   **"Enable create (sign-up)"** / client sign-up control is offered
   for your project tier, turn client sign-up **off** so accounts can
   only be created through the Turnstile-gated server route.
3. Keep `SESSION_SECRET`, `TURNSTILE_SECRET_KEY`, the Firebase Admin
   private key, and all other server secrets in deployment environment
   variables only — never in the repository. A Cloudflare **test**
   secret is rejected as a misconfiguration in production.

## Reporting

Security issues: contact the site operator via the details on the
Security page. Do not open public issues for vulnerabilities.

## Phase 2 additions

- Middleware checks only the session cookie's signature and expiry
  (no Redis/DB in the Edge runtime) for page redirects; revocation
  remains enforced per-request by the APIs via `requireSession`.
- The HttpOnly cookie is probed through `GET /api/auth/session-status`,
  which also performs the sliding re-issue. Clients treat a failed
  probe as "unknown" and never sign a user out because of a network
  error, a token-refresh error, or a deployment.
- Sessions end on explicit sign-out, on revocation
  (`SESSION_REVOKED`), or on "sign out of all devices"
  (`POST /api/auth/logout-all`: Redis `validAfter:{uid}` + per-session
  revoke + Firebase `revokeRefreshTokens(uid)`).

## Phase 4 additions — route hardening

### Unified limiter and policies

All single-window limits now run through `lib/server/limit.ts`
(one Upstash pipeline per check: INCR + PEXPIRE, keys hashed).
Policies: **closed** (auth, destructive and write routes — when
Redis is configured but unreachable the request is denied with 503)
and **open** (cheap reads — the same failure only logs a warning).
When Redis is not configured at all, checks are skipped with a
warning (local development); production must configure Upstash.
The Phase 1 auth limiter delegates to the same helper with the
closed policy; the Phase 1/3 two-window chat/upload limiter
(minute + day) is unchanged.

Final limit table (per user unless stated):

| Route | Limit | Policy |
| --- | --- | --- |
| POST /api/auth/sign-in | 8 / 10 min per IP+email, 30 / hour per IP | closed |
| POST /api/auth/sign-up | 10 / hour per IP (Phase 4) | closed |
| POST /api/auth/session | 20 / hour per IP | closed |
| POST /api/auth/reset | 3 / hour per IP+email | closed |
| POST /api/auth/resend-verification | 1 / 60 s | closed |
| POST /api/auth/logout | 60 / hour per IP (Phase 4) | closed |
| POST /api/auth/logout-all | 10 / hour (Phase 4) | closed |
| GET /api/auth/session-status | none (cheap probe; see route comment) | — |
| POST /api/chat | 10 / min and 60 / day (unchanged) | closed |
| POST /api/chats | 30 / day (Phase 4) | closed |
| POST /api/chats/migrate | 3 / day (Phase 4) | closed |
| PATCH /api/chats/[chatId] | 60 / hour (Phase 4) | closed |
| DELETE /api/chats/[chatId] | 60 / hour (Phase 4) | closed |
| POST /api/uploads/sign | 5 / min and 20 / day (unchanged) | closed |
| POST /api/uploads/confirm | 60 / hour (Phase 4) | closed |
| GET /api/uploads/access | 60 / hour (Phase 4) | open |
| DELETE /api/uploads/[assetId] | 60 / hour (Phase 4) | closed |
| PATCH /api/settings | 120 / hour | closed |
| PATCH /api/settings/profile | 60 / hour (Phase 4) | closed |
| POST /api/settings/avatar | 20 / hour (Phase 4) | closed |
| DELETE /api/settings/files | 60 / hour (Phase 4) | closed |
| POST /api/settings/delete-chats | 3 / day | closed |
| POST /api/export | 1 / day | closed |
| POST /api/account/change-password | 5 / hour | closed |
| POST /api/account/sessions (revoke) | 30 / hour (Phase 4) | closed |
| POST /api/account/delete | 1 / day | closed |
| POST /api/client-error | 20 / 10 min per IP (in-memory, no Redis spend) | — |

### Mutation guard

Every POST/PATCH/DELETE API route now requires a matching `Origin`
header (a missing Origin is rejected — including
`/api/uploads/sign`, which previously tolerated one) and the
`X-Requested-With: xyro` header. Auth/settings routes use
`guardAuthPost`; the session+token routes use the shared
`guardMutationHeaders` from the same module. `/api/client-error`
is aligned: its client sends the header and the route requires it
(its in-memory limit is unchanged).

### Upload content validation

`/api/uploads/confirm` no longer trusts Cloudinary metadata alone:
after the size/format checks it samples the stored file's actual
bytes (head only — 4 KB for binary formats, 64 KB for text; a
Range request plus early stream cancel keeps the Cloudinary
bandwidth cost to a few KB per file) and verifies magic bytes for
jpg/png/webp/gif/pdf or UTF-8 validity for txt/md/csv. A mismatch
deletes the Cloudinary asset and its Firestore record and returns
415 CONTENT_TYPE_MISMATCH.

## Phase 7 additions — image creation and file analysis

### Image creation route

`POST /api/images/generate` sits behind the same defences as every
other app API: `guardMutationHeaders` (Origin +
`X-Requested-With: xyro`), the session cookie + Firebase ID token
with matching uid, and the verified-email gate. It is rate-limited
to **10 creations per user per day, fail closed**, and pauses with
the daily budget guard. The prompt is length-capped (2,000 chars)
and the request body is capped at 8 KB.

Only FREE image-generation models are ever called: the route reads
the live OpenRouter catalogue (`getFreeImageModels` in
`lib/server/models.ts` — free by the same pricing rule as chat,
with "image" in the output modalities) at request time. When the
list is empty the route answers 503 `IMAGE_MODEL_UNAVAILABLE` and
creates nothing. A test hook (`XYRO_TEST_NO_IMAGE_MODELS=1`) can
force the empty list locally and is ignored in production
(`VERCEL_ENV=production`), mirroring the budget test override.

### Watermarking

A generated image is never stored unwatermarked: the model output
is downloaded server-side, an LSB-steganography payload
(`xyro-ai:<generationId>:<sha256(uid)[:16]>`, CRC-32 checked) is
embedded by `lib/server/watermark.ts`, and only the watermarked
PNG is uploaded — to Cloudinary as an **authenticated** asset
under `xyro/generated/{uid}`, recorded as a normal upload document
(`kind: "generated"`) so the existing access/delete cascades apply.
The payload contains no email, name or raw uid. Watermarking is a
provenance signal, not a security control: it can be destroyed by
re-encoding or heavy editing, and its absence proves nothing.
`scripts/verify-watermark.mjs` reads a payload back from a stored
PNG.

### File analysis

Attachment bytes are only ever read server-side from the stored
Cloudinary asset via the authenticated download path — the client
cannot supply document text. PDFs are parsed on the server with a
pure-JS extractor (`lib/server/pdf-text.ts`, unpdf/pdf.js): no
OpenRouter file-parser plugin is used any more, so no per-page
parsing fees and no document bytes leave for a parsing service.
Extraction is capped (10 MB, 100 pages, shared 60,000-character
prompt budget); a PDF with no text layer fails with a clear
user-facing error. When a chat carries image attachments, the
route routes the request to a free vision-capable model; if none
exists, the image parts are stripped and a note in the prompt makes
the model tell the user it cannot see them — attachments are never
silently dropped.

| Route | Limit | Policy |
| --- | --- | --- |
| POST /api/images/generate | 10 / day | closed |

## Phase 9 — pre-release security audit (2026-11-15)

A full audit pass was run against the production build before the
first public push: secrets scan of the entire working tree,
dependency review, response-header capture, Firestore/RTDB/Storage
rules review, a curl auth-bypass battery against every API route,
and a code-level review of the highest-risk seams (session,
Turnstile, request auth, upload access, export, account deletion,
image generation, PDF extraction). `npm run build` passes after
all fixes below.

### Fixes applied during this audit

1. **SSRF / unbounded download in image generation**
   (`app/api/images/generate`). The model-returned image URL is
   prompt-influenced and therefore untrusted. The download now
   requires https, refuses redirects, rejects credentials in the
   URL and private/loopback/link-local/CGNAT IP-literal hosts and
   local hostnames, honours `Content-Length`, and streams the body
   with a hard 15 MB cap instead of buffering it whole.
2. **Firestore profile writes are now server-only**
   (`firestore.rules`). The `users/{uid}` document previously
   allowed strictly-validated client create/update; all client
   profile writes were removed in Phase 2 and profiles are written
   by the server (sign-up/session routes, Settings → Profile), so
   the rule now denies client create/update/delete outright. A
   client can no longer set an arbitrary `photoURL`/`displayName`
   by talking to Firestore directly. **Deploy the updated rules**
   (SETUP.md section 3) — until they are deployed, the console
   still has the previous, wider rule.
3. **`/api/client-error` Origin check aligned** with the shared
   mutation guard: a missing `Origin` is now rejected (403), not
   merely a mismatched one. The route remains unauthenticated by
   design (it only logs truncated, non-personal error fields) and
   keeps its in-memory 20-per-10-minutes-per-IP limit — verified
   live: requests 1–20 returned 204, request 21+ returned 429.

### Verified in this audit

- **Secrets scan: clean.** No real credentials anywhere in the
  push set (tracked + untracked, excluding `node_modules`/`.next`):
  no `sk-or-` keys, private-key blocks, cloud secrets or session
  secrets. `.env.local` is covered by `.gitignore` (`.env*` with
  `!.env.example`) and is **not** in the push set; it contains only
  Cloudflare's public test keys and dummy Firebase values locally.
  `.env.example` contains placeholders only.
- **Auth-bypass battery: pass.** Every app API route returned 401
  with no cookie, with a tampered-signature cookie, and with a
  valid cookie but no Firebase ID token. Mutations without
  `Origin` returned 403 and without `X-Requested-With: xyro`
  returned 400 on every sampled route, including
  `POST /api/images/generate` and `POST /api/uploads/sign`.
  Oversized bodies are rejected (400). The removed
  `/api/auth/turnstile` returns 404. Three routes validate body
  shape before auth (settings/profile, change-password, settings
  PATCH); with a valid-shaped body they return 401 like the rest,
  and the 400s leak nothing. `POST /api/auth/logout` without a
  session returns 200 by design — it only clears the cookie and
  grants nothing.
- **Headers: pass.** `/`, `/sign-in`, the signed-out `/chat`
  redirect and `/api/health` all carry the nonce CSP with
  `'strict-dynamic'` (the served page's scripts carry the same
  nonce, including the theme pre-paint script), HSTS (1 year,
  includeSubDomains), `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  Permissions-Policy, COOP/CORP. No Trusted Types directive
  (Phase 0). HTML is `no-store`; immutable caching appears only on
  `/_next/static/*`.
- **Rules: pass (after fix 2).** Firestore: per-user isolation on
  `users/{uid}` and all subcollections, settings/sessions/profile
  writes server-only, catch-all deny. RTDB: default deny,
  `chatStreams/{uid}/{chatId}` readable only by its owner and
  writable only by the server (Admin SDK bypasses rules; clients
  get `.write: false`), presence owner-only boolean writes.
  Firebase Storage: deny-all (media lives in Cloudinary).
- **Code review: pass with the fixes above.** Session JWT
  (HS256 pinned, `exp` + absolute expiry, revocation via Redis
  with a 30 s cache), Turnstile (action + hostname enforced with
  real secrets; test secrets rejected when
  `VERCEL_ENV=production`), request auth (session uid must match
  ID-token uid on every app API), upload access/export/account
  paths are always built from the authenticated uid — never from
  request input — so one user cannot reach another's assets or
  data. Account deletion requires the typed `DELETE` confirmation
  on every call and a server-side password re-check on the first
  call of a run. PDF extraction is capped at 10 MB / 100 pages /
  60,000 prompt characters and verifies the `%PDF-` signature.

### Honest residual risks (accepted, not zero)

- **Firebase public endpoints** — see the dedicated section
  above. The web API key is public by design; product access is
  what the session cookie gates. The Google Cloud console
  hardening steps listed there are manual and must actually be
  done.
- **`npm audit` could not run in the audit environment** — the
  managed npm registry in the build VM rejects the audit endpoint
  (`403 policy_denied`). Installed versions were instead checked
  against published advisories: `next 15.5.29` (the patched
  release for the November 2026 batch and React2Shell-era fixes),
  `react 19.3.1`, `firebase 12.19.0`, `firebase-admin 14.5.1`,
  `jose 6.2.17`, `cloudinary 2.11.0`, `unpdf 2.2.1` — none falls
  in a known affected range as of 2026-11-15. Run `npm audit` in
  CI or locally before each release and enable Dependabot on the
  repository; treat this as a standing chore, not a one-time pass.
- **Revocation requires Redis.** Without Upstash configured,
  session revocation checks are skipped (documented in
  `lib/server/session.ts`): logout still clears the cookie, but a
  copied cookie remains valid until expiry. Production must
  configure Upstash. Even with Redis, revocation is cached for up
  to 30 seconds per session.
- **Turnstile hostname policy accepts any `*.vercel.app`
  subdomain** (preview deployments). A token still has to be
  minted with this site's site key on that hostname, and
  Cloudflare binds the site key to the domains configured in its
  dashboard — keep that domain list tight.
- **Image-download DNS rebinding** is not fully excluded: the
  SSRF fix blocks IP-literal and local hosts and refuses
  redirects, but a public hostname that resolves to a private
  address is not re-checked after DNS resolution. The downloaded
  bytes are parsed as an image by the watermark step and are
  never returned to the caller, which bounds the impact.
- **Free-tier quotas are the real DoS surface.** Per-route limits
  and the budget guard assume Redis is configured; a determined
  attacker can still burn shared free quota (Firestore reads,
  Cloudinary credits, OpenRouter free models) faster than paying
  users would like. There is no billing-backed headroom by design.
- **Test keys prove shape, not success.** Local verification used
  Cloudflare test keys and dummy Firebase values: guard, session
  and error paths are proven, but the success paths that need real
  Firebase Admin / Upstash / Cloudinary credentials (custom-token
  minting, Redis revocation, avatar upload, settings persistence,
  export contents, deletion cascades) can only be verified on the
  real deployment — see the SETUP.md post-deploy checklist.
- **Browser behaviour is not covered by this audit.** The VM
  could not start a real browser (Phase 0 note), so the 390 px
  in-browser checks (including the original `/sign-up` crash
  scenario) remain a manual post-deploy item in SETUP.md.
- **No free image model exists right now** (Phase 7 finding):
  image creation honestly returns 503 `IMAGE_MODEL_UNAVAILABLE`
  until one appears in OpenRouter's free catalogue. That is the
  designed behaviour, not a defect — but it means the generation
  success path (download → watermark → Cloudinary) is verified by
  unit tests and code review, not end-to-end.
- `.DS_Store` files are tracked from the original repository
  history. They contain no secrets; removing them is cosmetic and
  was left out of this audit to keep the diff focused.

### Daily budget guard

`lib/server/budget.ts` keeps Redis daily counters estimating
Firestore reads/writes and Redis commands (estimate model in the
file header; recording is one EVAL per instrumented request, at
/api/chat turns, chat create/patch/delete and uploads confirm).
Firestore writes are the binding quota (Spark: 20k writes/day).
In /api/chat: at ≥85% of the write budget, new turns are queued —
429 with code BUDGET_QUEUE and a Retry-After; the chat client
shows a queued state and retries once automatically. At ≥95%,
chat pauses with 503 BUDGET_PAUSED. GET /api/usage reports the
current budget percentages. When Redis is unconfigured the guard
is skipped with a warning.

## Device signals — fingerprinting and login telemetry

Added after the Phase 9 audit, at the owner's request, to make
bot/abuse detection and account-security visibility stronger.

**What is collected at sign-in / sign-up (and only then):**

- A device fingerprint hash computed in the browser
  (`lib/device-fingerprint.ts`) from ordinary signals — user agent,
  platform, languages, timezone, screen size/colour depth,
  hardware concurrency, device memory, touch points and a small
  canvas render — hashed with SHA-256. Only the hash leaves the
  browser; it is cached only in `sessionStorage` (per tab session),
  never in a persistent cookie, and never used across sites.
- Server-side facts (`lib/server/device.ts`): the user agent parsed
  into browser / OS / device type, and the client IP stored **only**
  as an HMAC-SHA256 hash keyed with `SESSION_SECRET`, so raw IPs
  never land in the database while equal IPs still correlate.

**Where it is stored (Firestore, all writes server-side via Admin):**

| Location | Contents |
| --- | --- |
| `users/{uid}/sessions/{sid}` | device label, `deviceId`, `authMethod` (password/google), `newDevice` flag, `ipHash`, coarse Vercel city/country, timestamps |
| `users/{uid}/devices/{deviceId}` | label, browser, OS, device type, user agent, first/last seen, login count, last `ipHash` |
| `users/{uid}/securityEvents/{id}` | `sign_in` / `sign_up` / `google_sign_in` / `new_device` / `device_velocity` events with device label + `ipHash` |
| `deviceSignals/{deviceId}` | sign-up velocity counter: total accounts created from the fingerprint + capped list of account-id hashes; **no client access at all** |

Client access is owner-read-only for `sessions`, `devices` and
`securityEvents` (see `firestore.rules`); everything is written by
the server, and recording is best-effort — a telemetry failure can
never break or block a sign-in.

**How it is used:**

- Settings → Security shows the session list (with a **New device**
  badge and sign-in method), the account's device registry and the
  recent security activity feed, so a user can spot and revoke
  sign-ins they don't recognise.
- A fingerprint the account has never seen produces a `new_device`
  event.
- Five or more accounts created from one fingerprint produces a
  `device_velocity` event on the new account. It is a signal for
  review, **not** an automatic block: households, schools and
  shared computers legitimately create many accounts from one
  device.

**Honest limits:** a fingerprint is a hint, not an identity proof.
It can be spoofed by a determined attacker and can change when a
browser updates or privacy settings change (which simply looks
like a new device). It complements — never replaces — Turnstile,
per-IP/per-account rate limits and server-side sessions, and it is
never the sole basis for denying access.

## Developer API — keys, metering and request fingerprints

Settings → Developer activates API access (verified accounts only)
after an onboarding popup (project name, use case, builder type,
primary language, optional website, API-terms acceptance — all
saved to `users/{uid}/developerProfile/main`).

- **Keys** look like `xyro_sk_live_…` (32 random characters). Only
  the SHA-256 hash is stored: per-user records in
  `users/{uid}/apiKeys/{keyId}` and a server-only lookup in the
  top-level `apiKeys/{keyHash}` collection (clients have no access
  at all). The full key is shown exactly once at creation; at most
  5 active keys per account; revocation deletes the lookup in the
  same batch, so a revoked key dies immediately.
- **Endpoints**: `POST /api/v1/chat/completions` and
  `GET /api/v1/models`, OpenAI-shaped, CORS-open (the key is the
  credential), backed by the same free OpenRouter models as the
  app. No session cookie or browser origin guard applies — these
  routes authenticate purely by key, and separately require the
  owning account to be enabled and email-verified.
- **Limits**: free plan 100,000 tokens/day per account, enforced
  from the Firestore daily rollup (`users/{uid}/apiUsage/{date}`,
  resets midnight UTC) before each call; 20 requests/minute per
  key via the Redis limiter; ≤50 messages and max_tokens ≤4096 per
  request.
- **Request fingerprints**: every authenticated call appends an
  event to `users/{uid}/apiEvents` with the key prefix, model,
  token counts, status, parsed user agent / device label and the
  client IP as an HMAC hash (never raw), plus coarse Vercel geo —
  the same treatment as login telemetry, so key misuse from an
  unexpected place is visible in Settings → Developer.
- Token counts come from the upstream usage block when present;
  otherwise they are estimated at ~4 characters/token and the
  event is flagged `tokensEstimated`.
- **Strict request surface**: requests must be
  `Content-Type: application/json`; unknown top-level parameters
  are rejected by name (`unknown_parameter`); messages must be
  objects with only `role` + non-empty `content`; `max_tokens`
  must be an integer; `temperature` is the only sampling knob
  (0–2). Failed key attempts are throttled per IP (30/min) so
  keys cannot be scanned against the auth lookup, and a key
  whose developer profile is gone stops working (orphan check).
- **Cost metering**: each event and the daily/per-model rollups
  (`users/{uid}/apiModelUsage`) carry an estimated USD cost from
  the model's OpenRouter catalogue prices (per-token strings
  converted to per-1M). All current models are free, so the
  estimate is $0 — the plumbing exists so a future paid model is
  metered correctly from day one.
- **Access points**: each distinct API client (IP hash + user
  agent fingerprint) is upserted into
  `users/{uid}/apiAccessPoints` with its detected coarse
  location, request count and first/last seen, and shown in the
  dashboard next to the key it used.
- **Input/output logs**: the request messages and the response
  text are stored (capped at 8,000 chars each) on the event,
  disclosed in the API terms and the privacy center, and visible
  to the account owner in the dashboard's activity log. This is
  the industry-standard abuse/debugging log — it is not shared
  with third parties.

## Robustness round (2026-11-15, later)

- **OpenRouter calling discipline** (`lib/server/openrouter.ts`):
  chat and the public API now share one fallback walker —
  `modelAttemptOrder` yields up to 4 attempts (requested → Auto
  router → two curated free models), each with a 25s connect
  timeout (headers only, so long streamed replies are never
  killed by it), backoff between attempts honouring Retry-After
  (capped 5s), and network errors moving to the next model
  instead of failing the request (the public API previously
  returned 502 on the first network error).
- **Long replies**: chat `max_tokens` 2048 → 4096; the stream
  reader uses a 50s IDLE timeout rather than a 45s total one,
  and a stream that dies after producing text keeps the partial
  reply as the answer; the server republishes the RTDB stream
  node every 8s as a heartbeat so slow first tokens are not
  mistaken for a stall; the client stall fallback moved 12s →
  30s; `/api/chat` and `/api/v1/chat/completions` maxDuration
  raised 60 → 300.
- **Image creation sources**: OpenRouter's catalogue still has
  zero free image models, so creation falls back to the
  Pollinations free generation service (fixed host, prompt-only,
  3 attempts with backoff, image content-type + size cap +
  watermark parse before storage; disclosed on the
  subprocessors page). The watermark → Cloudinary → Firestore
  pipeline is unchanged.
- **Cloudinary config decoupling**: only the browser
  direct-upload signing flow requires `CLOUDINARY_UPLOAD_PRESET`
  now; generated-image/avatar uploads and signed download URLs
  need just cloud name + API key/secret. Previously a missing
  preset broke generated-image storage too.

## Platform analytics (admin-only)

Every metered AI call (chat turn, public API call, image creation)
is recorded server-side into a token ledger (`usageEvents`, with
millisecond timestamps) and per-minute / per-day rollups
(`analytics_minutes`, `analytics_days`, per-model and per-user
variants). The records carry token counts, the model used and the
catalogue-price cost estimate — never message content — and they
live outside the user's collections on purpose, so deleting a chat
does not rewrite the platform's usage history. Firestore rules deny
all client access to these collections; the only reader is
`GET /api/admin/overview`, which requires a signed-in session whose
account email is on the admin allowlist (`lib/server/admin.ts`,
extensible via the `ADMIN_EMAILS` environment variable). Chat token
counts come from the provider's streamed usage when reported and
are otherwise ~4 chars/token estimates flagged `tokensEstimated`.

## Turnstile policy by sign-in method

Turnstile gates the email/password paths (sign-in, account
creation, password reset) and session renewal for password
accounts. "Continue with Google" is exempt by design: the session
route verifies the Firebase ID token first and reads the provider
from the token itself (`firebase.sign_in_provider`); only when it
is `google.com` is the Turnstile check skipped, because Google's
OAuth is the human check for that path and a widget token cannot
survive the full-page redirect mobile browsers use. The exemption
cannot be claimed by a password token — the provider claim is
inside the server-verified token — and the route's per-IP rate
limit, token-freshness window, revocation check and terms gate
apply to Google sign-ins unchanged.

## Web search and link reading (2026-11-16)

- When the composer's web toggle is on, the chat route sends the
  user's message text as a query to Bing's public results page (no
  API key) and injects the top results as context; links pasted into
  a message are fetched and read on any turn. Retrieved sources are
  stored on the assistant message and shown to the user.
- Link fetching is SSRF-guarded (lib/server/web-search.ts): only
  http/https, hostnames resolving to private/reserved IPs are
  refused, every redirect hop is re-validated, responses are capped
  at 1.5 MB and 9 s, and only HTML/plain-text is read.
- Residual risk: DNS rebinding between the resolve-check and the
  fetch (TOCTOU) is not fully preventable without connection-level
  IP pinning; the impact is bounded by the response caps and by the
  fact that fetched content is only ever shown back as text context
  to the requesting user.
- Terms-gate note (from the Google sign-in round): the new-account
  terms check in /api/auth/session applies only when the account is
  new AND has no profile yet, on every action including
  session_refresh — closing the earlier silent-renewal bypass.

## Admin control plane (2026-11-16, later)

- Admin authority is database-driven: the `admin` field on the
  user's own profile document (users/{uid}) is the source of
  truth, checked server-side on every admin request
  (lib/server/admin.ts: authenticateAdmin → isAdminUser). The
  email allowlist (ADMIN_EMAILS + the bootstrap owner email)
  remains only as a recovery path so the owner can never be
  locked out before the first flag exists.
- Self-promotion is impossible by construction: Firestore rules
  deny ALL client writes to profile documents, so the admin flag
  can be written only by the server (an existing admin via
  /api/admin/users, or the project owner in the Firebase
  Console).
- Admin controls: promote/demote (writes the flag),
  disable/enable (Firebase Auth disabled state). An admin cannot
  demote or disable their own account. Every action is recorded
  in the adminActions audit collection (rules: no client
  access) and the route is rate-limited per admin.
- The Python backend's address (BACKEND_URL) and its service
  token are server-only environment values. They are never sent
  to a browser: the admin console receives only the service's
  STATE (configured / reachable / mode / integrations-ok) from a
  server-side probe. The backend's own /health endpoint likewise
  returns only {ok} publicly; the detailed integration view
  requires the service token.

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

# Xyro AI — setup checklist

Complete deployment checklist for Xyro AI (package `xyro-ai`). The stack is
free-tier only by design: Firebase Spark, Vercel Hobby, OpenRouter free
models, Cloudinary Free, Upstash Redis Free, Cloudflare Turnstile. Do not
enable billing-backed features (Cloud Functions, Identity Platform paid
features, paid OpenRouter models, Firestore TTL/backups) — the code is built
around the free quotas.

Work top to bottom. Names in `CODE` are environment variable **names only** —
never commit real values; `.env.local` is gitignored and production values
belong in Vercel's environment settings.

---

## 1. Accounts to create (all free)

- [ ] Firebase project (Spark plan)
- [ ] Vercel Hobby account + project connected to this repository
- [ ] OpenRouter account and API key
- [ ] Cloudinary free account
- [ ] Upstash Redis free database
- [ ] Cloudflare account with a Turnstile site

## 2. Firebase project

- [ ] Create the project in the Firebase Console. Stay on the **Spark** plan.
- [ ] Register a **Web app** in the project; copy its config values into the
      `NEXT_PUBLIC_FIREBASE_*` variables (section 8). Web config values are
      public identifiers, not secrets.
- [ ] **Authentication → Sign-in method:** enable **Email/Password** and
      **Google**.
- [ ] **Authentication → Settings → Authorized domains:** add `localhost`,
      the production domain, and its `vercel.app` alias. Add exact preview
      hostnames only when testing those deployments.
- [ ] For Google sign-in, confirm the OAuth redirect URI
      `https://<your-auth-domain>/__/auth/handler` exists in the Google Cloud
      OAuth client (Firebase creates this automatically for the default
      `firebaseapp.com` auth domain).
- [ ] Keep the default `<project>.firebaseapp.com` auth domain unless you run
      a custom one; if custom, set `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` to it.

## 3. Firestore

- [ ] **Firestore Database → Create database** (production mode; location
      choice is permanent).
- [ ] Deploy the repository rules and indexes:
      `firebase deploy --only firestore:rules,firestore:indexes`
      (rule/index sources: `firestore.rules`, `firestore.indexes.json`,
      wired up in `firebase.json`).
- [ ] Know the data model the rules enforce: `users/{uid}` profile,
      `users/{uid}/chats/{chatId}/messages`, `users/{uid}/uploads`,
      `users/{uid}/settings/*` and `users/{uid}/sessions/*` — owners can read
      their own documents; all writes go through the server (Firebase Admin).

## 4. Realtime Database

- [ ] **Realtime Database → Create database** (locked mode). Copy its URL
      into `NEXT_PUBLIC_FIREBASE_DATABASE_URL` — it powers presence and the
      live chat response streams at `chatStreams/{uid}/{chatId}`.
- [ ] Deploy its rules: `firebase deploy --only database`
      (source: `database.rules.json`).
- [ ] Firebase Storage is **not** used (media lives in Cloudinary). Deploy
      `storage.rules` as deny-all if a default bucket exists:
      `firebase deploy --only storage`.

## 5. Firebase Admin (server credentials)

Account creation, profile writes, settings, export and deletion all run
through Firebase Admin on the server.

- [ ] **Project settings → Service accounts → Generate new private key** for
      a service account limited to Auth + Firestore + Realtime Database.
- [ ] Set `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`,
      `FIREBASE_ADMIN_PRIVATE_KEY` in `.env.local` and in Vercel
      (Production + Preview). In `.env` files, encode the private key's line
      breaks as literal `\n`.
- [ ] Never commit the service-account JSON; never prefix these with
      `NEXT_PUBLIC_`. If a key was ever shared, issue a new one.

## 6. Third-party services

### OpenRouter
- [ ] Create an API key; set `OPENROUTER_API_KEY` (server-only).
- [ ] The app only calls models whose pricing is zero (`:free` ids or
      0/0 pricing) plus the `openrouter/free` Auto router — verify no paid
      model or paid plugin is selected anywhere in your OpenRouter account.

### Cloudinary
- [ ] Create a **signed** upload preset that allows only `jpg`, `jpeg`,
      `png`, `webp`, `gif`, `pdf`, `txt`, `md`, `csv` with a 10 MB maximum.
      Do not enable unsigned uploads. Assets use authenticated delivery.
- [ ] Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
      `CLOUDINARY_API_SECRET`, `CLOUDINARY_UPLOAD_PRESET` (server-side;
      the secret must never reach the browser).

### Upstash Redis
- [ ] Create a free Redis database (REST API enabled).
- [ ] Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
- [ ] Redis carries rate limits, session revocation and the daily budget
      counters. Without it, limits are skipped with a warning locally, and
      production routes that fail closed will return 503 — configure it
      before launch.

### Cloudflare Turnstile
- [ ] Create a Turnstile site for your domains (production, `vercel.app`
      alias, `localhost` for development).
- [ ] Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (public) and
      `TURNSTILE_SECRET_KEY` (server-only). Optionally set
      `TURNSTILE_HOSTNAME_ALLOWLIST` for extra accepted hostnames.
- [ ] Production rejects Cloudflare's public **test** secret as a
      misconfiguration — use the real secret in Production.

### Session secret
- [ ] Generate `SESSION_SECRET` (signs the session cookie, HS256; minimum
      32 characters): `openssl rand -base64 48`
- [ ] Set a **different** value per environment. Sessions cannot be issued
      while it is missing or short; rotating it signs everyone out.

## 7. Vercel project

- [ ] Import the repository; framework preset **Next.js**; Node 22.x.
- [ ] Add the production domain and set `SITE_URL` to the canonical HTTPS
      origin (for example `https://xyro.ai`). Leave `SITE_URL` blank only if
      you want the `vercel.app` deployment URL used for previews.
- [ ] Enter every variable from section 8 in **Production** and **Preview**.
- [ ] Keep the project on **Hobby**; pushes to `main` auto-deploy.

## 8. Environment variables (names only)

Required for the app to work:

| Variable | Where it comes from |
| --- | --- |
| `SITE_URL` | Your canonical production origin |
| `OPENROUTER_API_KEY` | OpenRouter dashboard |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase web app config |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase web app config |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase web app config |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase web app config |
| `NEXT_PUBLIC_FIREBASE_DATABASE_URL` | Firebase Console → Realtime Database |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase web app config |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | Firebase web app config (stored; Analytics is not initialised) |
| `FIREBASE_ADMIN_PROJECT_ID` | Service account |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Service account |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Service account (newlines as `\n`) |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | Cloudinary dashboard |
| `CLOUDINARY_API_SECRET` | Cloudinary dashboard |
| `CLOUDINARY_UPLOAD_PRESET` | Signed preset from section 6 |
| `UPSTASH_REDIS_REST_URL` | Upstash database details |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash database details |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile site |
| `TURNSTILE_HOSTNAME_ALLOWLIST` | Optional; comma-separated extra hostnames |
| `SESSION_SECRET` | `openssl rand -base64 48` |

Reserved in `.env.example` but **not read by the current code** — leave them
unset unless a future feature lands: `KEK_V1`, `API_KEY_PEPPER`,
`DEVICE_HASH_SECRET`, `APP_CHECK_SITE_KEY`, `APP_CHECK_SECRET_KEY`,
`EMAIL_PROVIDER_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`CRON_SECRET`, `MARK_KEY`, `MARK_SERVICE_SECRET`. (Email verification and
password reset use Firebase's built-in flows, so no email provider key is
needed.)

## 9. Post-deploy verification

- [ ] `npm run verify:firebase` — checks the Firebase configuration the app
      can see and reports each integration as present/missing.
- [ ] `GET /api/health` on the deployment — returns `{ ok: true }` and a
      boolean per integration (firebaseWeb, firebaseAdmin, realtimeDatabase,
      openRouter, cloudinary, redis, turnstile, session). It never returns
      values. Every boolean should be `true` in production.
- [ ] Sign up with a test account: Turnstile passes, the verification email
      arrives, and after verifying you can send a chat message and attach a
      file.
- [ ] Sign in on a second device: chat history syncs; Settings → Security
      shows both sessions; revoke one and confirm its next action fails.
- [ ] Visit `/` signed out (landing page) and signed in (redirects to
      `/chat`); spot-check `/pricing`, `/help`, `/security` and `/faq`.
- [ ] `GET /sitemap.xml` lists the landing page and every public page.

### Security verification (from the Phase 9 audit)

- [ ] Confirm the deployed Firestore/RTDB rules in the Firebase Console
      match `firestore.rules` / `database.rules.json` in this repo —
      in particular that `users/{uid}` profile writes are **denied** to
      clients (Phase 9 tightened this; older deployments may still run
      the previous rule). Rules only take effect when deployed
      (sections 3–4); the console is the source of truth for what is
      live.
- [ ] Complete the Google Cloud API-key restrictions and the Firebase
      Authentication settings listed under "Required console hardening"
      in `SECURITY.md` — they are console-only and cannot be verified
      from the repository.
- [ ] Run `npm audit` (the audit environment used for development could
      not reach the npm audit endpoint) and enable Dependabot on the
      GitHub repository so dependency advisories surface automatically.
- [ ] Open `/sign-up` in a real browser at ~390 px width and complete a
      sign-up: this is the original Phase 0 crash scenario (Trusted
      Types) and could not be exercised in the development VM.
- [ ] Confirm Upstash is configured in Production: without it, session
      revocation and the fail-closed rate limits are inactive
      (SECURITY.md, residual risks).

## 10. Operational notes

- Quotas that shape the product: Firestore 50k reads / 20k writes per day,
  Realtime Database 100 simultaneous connections, Upstash 500k
  commands/month, Cloudinary ~25 credits/month. The in-app budget guard
  queues chat at 85% of the daily Firestore-write estimate and pauses at
  95%; Settings → Usage shows the counters.
- Rate limits, the full limit table, and residual risks (including the
  Firebase public-endpoint discussion and the Google Cloud API-key
  restriction steps) are documented in `SECURITY.md`.
- The per-request CSP nonce means HTML is rendered dynamically; static
  assets remain cacheable. Browser-side Firebase failures appear in the
  browser console and Firebase consoles, not in Vercel logs.

# Xyro AI setup checklist

This project is designed for a totally free stack and intentionally avoids paid Firebase / Vercel / OpenRouter features. Before launch, complete each item below.

## Free accounts to create

- Firebase project (Spark plan or free tier)
- Vercel Hobby account for hosting
- OpenRouter account with a free API key
- Cloudinary free account
- Upstash Redis free account
- Cloudflare Turnstile account
- Resend free account (or Brevo free account if preferred)
- GitHub repository and GitHub Actions enabled

## Required Firebase settings

- In Firebase Authentication > Settings > Authorized domains, add:
  - localhost
  - the stable production hostname (including its `vercel.app` alias, if used)
  - your custom production domain, if any
  - exact Vercel preview hostnames only when testing those deployments
- Set the Google OAuth redirect URI to:
  - `https://<domain>/__/auth/handler`
- Keep the Firebase project's default `firebaseapp.com` auth domain unless a
  custom auth domain is configured. If using a custom domain, set
  `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` to it and confirm the `/__/auth/*` rewrite
  reaches `<project-id>.firebaseapp.com`.
- Confirm the Firebase project allows Google sign-in and email/password sign-in.
- Create the Cloud Firestore database and deploy the repository's `firestore.rules`.
- Create a Realtime Database and deploy `database.rules.json`.
- Set the web app configuration in `.env.local` or Vercel environment variables.
- Set `NEXT_PUBLIC_FIREBASE_DATABASE_URL` to the exact Realtime Database URL.
- Keep the project on the free Firebase plan. Do not enable paid Identity Platform features.
- Signup saves the basic user profile to Firestore immediately after Firebase
  Authentication creates the account. Email verification is required before
  accessing AI features; if Firestore rejects the profile write, the sign-in
  screen offers a retry. Verify that the deployed rules allow each signed-in
  user to read and write only their own `users/{uid}` profile.
- Firestore is the source of truth for user profiles. Realtime Database stores
  only per-device presence connections; authentication credentials belong only
  in Firebase Authentication and are never copied to either database.

## Required Vercel settings

- Add the production domain in the Vercel project.
- Set `SITE_URL` to the canonical production origin, such as `https://xyro.ai`.
- Set all required environment variables in Production and Preview.
- Keep the app on the Hobby plan and note that it is non-commercial and personal-use only.

## Required Cloudflare / Turnstile settings

- Create a Turnstile site and secret key.
- Add the site key to `TURNSTILE_SITE_KEY` and secret key to `TURNSTILE_SECRET_KEY`.
- Use Turnstile on sign-up, sign-in, password reset, and other high-risk actions.

## Required OpenRouter settings

- Create a free OpenRouter account and generate an API key.
- Store the key in `OPENROUTER_API_KEY` only on the server.
- Verify that no paid model or paid plugin is selected.
- Note that shared free-tier limits apply to the account as a whole.

## Required Cloudinary settings

- Create a Cloudinary free account and keep storage under the per-user limit.
- Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in the server env.
- Keep image sizes compressed to 2048px maximum and under the 5 MB upload cap.
- Use the app's own proxy route rather than public Cloudinary URLs when possible.

## Required Upstash settings

- Create an Upstash Redis free database.
- Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
- Keep the Redis usage below the free monthly command budget.

## Required email settings

- Create a Resend or Brevo free account.
- Set `EMAIL_PROVIDER_API_KEY` and VAPID keys if web push is used.
- Use Firebase's built-in email verification and password reset flow for standard actions.

## Required operational settings

- Set `KEK_V1`, `API_KEY_PEPPER`, `DEVICE_HASH_SECRET`, `CRON_SECRET`, and `APP_CHECK_*` values in the server environment.
- Configure Firebase App Check with reCAPTCHA v3 and enforce it on protected routes.
- Add the `firebaseapp.com` auth host and custom domain mapping when using the browser auth flow.
- Keep the Firebase Storage rules deny-all because the app currently does not use Firebase Storage.

## Deployment checklist

- [ ] Firebase web config values are in place
- [ ] The stable Vercel production hostname is in Firebase Auth authorized domains
- [ ] `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` matches the Firebase auth domain configured for the app
- [ ] `SITE_URL` is set to the canonical HTTPS origin
- [ ] Vercel Preview and Production env vars are populated
- [ ] Google OAuth redirect URL is configured
- [ ] Firebase Auth authorized domains include local and production hosts
- [ ] `https://<domain>/__/auth/handler` is set as the Google OAuth redirect URI
- [ ] Firestore rules are deployed
- [ ] Realtime Database URL is set in Vercel Production and Preview
- [ ] Realtime Database rules are deployed
- [ ] Storage rules are deployed as deny-all
- [ ] OpenRouter API key is set server-side only
- [ ] Turnstile keys are configured
- [ ] Cloudinary keys are configured
- [ ] Redis keys are configured
- [ ] Email provider API key is configured
- [ ] App Check keys are configured
- [ ] `npm run build` succeeds locally after the runtime is installed

## Notes

- Vercel Hobby is non-commercial and personal-use only.
- Firebase Auth, Firestore, and Realtime Database browser SDK requests go
  directly from the browser to Firebase; Vercel runtime logs do not show those
  failures. Use the browser console/network panel and the Firebase consoles to
  diagnose client-side auth or database errors.
- The per-request CSP nonce requires dynamic HTML rendering so Next.js can put
  the matching nonce on its scripts. Static assets remain cacheable, but HTML
  pages are rendered per request.
- This app keeps host-specific configuration isolated when reasonable so features are easy to move later.
- No paid provider add-ons or billing-backed features should be enabled for this project.
- The password breach check sends only a SHA-1 hash range to the server; the
  server queries the Have I Been Pwned k-anonymity endpoint and never receives
  the plaintext password.
- The current site is not load-tested for 100,000 simultaneous users. Firebase
  Spark's daily quotas and Vercel Hobby limits do not establish that capacity;
  high-concurrency chat requires a separately designed and measured backend.

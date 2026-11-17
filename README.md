# Xyro AI

Xyro AI is an independent product with Firebase-backed sign-in, durable chat history, and a text-chat workspace. Chat responses use OpenRouter's free-model router, with live updates through Firebase Realtime Database. Images and documents are stored as private authenticated Cloudinary assets.

## Requirements

- Node.js 22.x
- npm

## Run locally

```sh
npm ci
npm run build
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Create a production build with `npm run build` and serve it with `npm run start`.

## Test

```sh
npm test            # web app unit tests (Node test runner, tests/)
npm run build       # production build — part of the gate
cd backend && python -m pytest   # Python backend suite (the documented command)
```

The backend suite also runs under its legacy runner
(`python tests/test_units.py`), but `python -m pytest` from
`backend/` is the canonical command. GitHub Actions runs all
three — `npm test`, `python -m pytest` and `npm run build`,
plus the admin panel build — on every push and pull request
(see `.github/workflows/ci.yml`).

Copy `.env.example` to `.env.local` and fill in the Firebase Web App values,
including the Realtime Database URL:

```sh
cp .env.example .env.local
```

The Firebase API key and other web config are public identifiers; all Firestore access is still enforced by the deployed rules. `SITE_URL` is optional locally and defaults to `https://xyro.ai`.

## Deploy to Vercel

Vercel detects Next.js automatically; no custom `vercel.json` is required. Import the Git repository into Vercel and deploy with the default Next.js build settings. `package.json` constrains the build runtime to Node.js 22.x.

Set the `NEXT_PUBLIC_FIREBASE_*` Web App values in Vercel's project settings for Production and Preview. Set `SITE_URL` to the canonical production origin (for example, `https://your-domain.example`); Preview deployments use Vercel's generated preview URL and are marked `noindex`. Add the stable production hostname (including its `vercel.app` alias, if used) to Firebase Authentication's authorized domains. Environment-variable changes apply to new deployments, so redeploy after updating them.

`OPENROUTER_API_KEY`, the Upstash Redis URL/token, Firebase Admin credentials, and Cloudinary credentials are required for chat and uploads. Keep them server-side; never prefix them with `NEXT_PUBLIC_`. The chat endpoint verifies Firebase ID tokens and email verification, limits each user to 10 requests per minute and 60 per day, saves messages to Firestore, and publishes in-progress responses through Realtime Database. Account creation requires a Cloudflare Turnstile site key and secret; the browser never receives the Firebase service-account key or Cloudinary API secret.

## Firebase setup

1. Create a Firebase project and register a Web App. Copy its config values into `.env.local` or the matching Vercel environment.
2. In Firebase Authentication, enable **Google** and **Email/Password** sign-in. Add `localhost` for local development and the stable production hostname under **Authorized domains**. Add the exact Vercel Preview hostname only when testing sign-in on that deployment.
3. Create a Cloud Firestore database and a Realtime Database. Set `NEXT_PUBLIC_FIREBASE_DATABASE_URL` to the exact Realtime Database URL shown in Firebase Console.
4. Link the project with Firebase CLI (`npx firebase-tools use --add`) and deploy the Firestore rules:

   ```sh
   npx firebase-tools deploy --project YOUR_FIREBASE_PROJECT_ID --only firestore:rules
   ```

5. Deploy the Realtime Database rules:

   ```sh
   npx firebase-tools deploy --project YOUR_FIREBASE_PROJECT_ID --only database
   ```

   If you enable Cloud Storage, deploy its rules separately:

   ```sh
   npx firebase-tools deploy --project YOUR_FIREBASE_PROJECT_ID --only storage
   ```

6. Deploy or restart the app after setting environment variables.

Signup creates the Firebase Authentication account and immediately creates its `users/{uid}` profile in Firestore. Email verification gates AI access, not profile persistence. Firestore stores profile data and durable chat history; clients can read only their own chats and messages, while the server performs writes. Realtime Database stores each signed-in user's presence and owner-readable live response streams; client writes are denied. Cloudinary assets use authenticated delivery and signed uploads. The app allows images, PDF, TXT, Markdown, and CSV files up to 10 MB each, five files (20 MB combined) per message, and 50 uploads per chat. Deploy `firestore.rules` and `database.rules.json` before enabling the workspace.

## Current site

- Server-rendered landing and information pages (nonce-based CSP requires per-request HTML rendering; static assets remain cacheable)
- Google and email/password Firebase sign-in, password reset, and private profile persistence (requires Firebase setup)
- Owner-only Firestore chat reads and Realtime Database presence/response-stream reads with client writes denied
- Responsive layout, keyboard focus treatment, and reduced-motion support
- Product overview, help guide, pricing information, and XyroAIDetect explainer
- Terms, Privacy, and Acceptable Use drafts marked for legal review
- Metadata, Open Graph artwork, JSON-LD, sitemap, robots, manifest, and offline information page
- Text chat is available with server-side OpenRouter and Upstash configuration; chats sync to Firestore and in-progress responses stream through Realtime Database
- Signed Cloudinary uploads support images, PDF, TXT, Markdown, and CSV files, with per-file and per-chat limits
- Image generation, research tools, payment, detector, and XyroSocial sign-in are not currently available

The legal pages remain drafts. Chat messages and uploads are stored in Firestore and Cloudinary. Prompts and relevant attachment content are sent to OpenRouter and its selected free model provider; review provider terms and do not send sensitive information.

## Configuration and secrets

Firebase web configuration is required for account sign-in and profile storage; `NEXT_PUBLIC_FIREBASE_DATABASE_URL` is required for Realtime Database presence and live response streams. Account creation also uses `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and `FIREBASE_ADMIN_*`. The chat/upload server additionally requires `OPENROUTER_API_KEY`, Upstash Redis credentials, and `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and `CLOUDINARY_UPLOAD_PRESET`. Only the Turnstile site key is public; keep all other credentials server-side.

Other planned integrations may require:

- `OPENROUTER_API_KEY` for server-side model requests
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for the required chat capacity guard
- Firebase Web App configuration for sign-in, plus `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, and `FIREBASE_ADMIN_PRIVATE_KEY` for server-verified account creation
- `MARK_KEY` and `MARK_SERVICE_SECRET` for server-side watermark operations

Do not add real credentials to this repository. Xyro AI is standalone; no shared XyroSocial domain, Firebase project, user collection, or SSO credentials have been provided.

## Security and deployment status

The current Next.js configuration adds browser security headers. Account creation validates Cloudflare Turnstile server-side before Firebase Admin creates the user; Firebase's client SDK then completes email verification and profile setup. Firestore rules deny client writes to chats and uploads; Realtime Database permits owners to read live response streams but denies client writes. Chat requests require verified Firebase ID tokens, persist responses in Firestore, publish live text through Realtime Database, and apply per-user limits through Upstash Redis. Upload signatures and metadata checks are server-side; Cloudinary assets use authenticated delivery.

The legal pages are drafts. Governing law, the legal operator, privacy contact, final data retention periods, and provider disclosures remain unspecified and require review before launch. The static site does not set non-essential cookies.

The Vercel Rust runtime is currently documented as beta. Before adopting it for image processing, measure the compiled artifact size, cold starts, memory, execution time, and the watermark robustness targets on the actual deployment configuration.

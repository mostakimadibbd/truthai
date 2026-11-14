# Xyro AI

Xyro AI is an independent product. The site includes server-rendered marketing pages and a Firebase-backed sign-in/profile foundation. AI chat, file upload, image generation, and other planned product features are not implemented yet.

## Requirements

- Node.js 22.x
- npm

## Run locally

```sh
npm install
npm run build
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Create a production build with `npm run build` and serve it with `npm run start`.

Copy `.env.example` to `.env.local` and fill in the Firebase Web App values,
including the Realtime Database URL:

```sh
cp .env.example .env.local
```

The Firebase API key and other web config are public identifiers; all Firestore access is still enforced by the deployed rules. `SITE_URL` is optional locally and defaults to `https://xyro.ai`.

## Deploy to Vercel

Vercel detects Next.js automatically; no custom `vercel.json` is required. Import the Git repository into Vercel and deploy with the default Next.js build settings. `package.json` constrains the build runtime to Node.js 22.x.

Set the `NEXT_PUBLIC_FIREBASE_*` Web App values in Vercel's project settings for Production and Preview. Set `SITE_URL` to the canonical production origin (for example, `https://your-domain.example`); Preview deployments use Vercel's generated preview URL and are marked `noindex`. Add the stable production hostname (including its `vercel.app` alias, if used) to Firebase Authentication's authorized domains. Environment-variable changes apply to new deployments, so redeploy after updating them.

The `OPENROUTER_API_KEY`, `FIREBASE_ADMIN_*`, and watermark variables are reserved for planned server-side integrations and are not used by the current site. Do not prefix them with `NEXT_PUBLIC_`. No Firebase Admin credentials are needed for the current client-auth/profile flow.

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

Signup creates the Firebase Authentication account and immediately creates its `users/{uid}` profile in Firestore. Email verification gates AI access, not profile persistence. Firestore is the source of truth for profile data; Realtime Database stores only the signed-in user's active presence connections and never duplicates profile data or credentials. `firestore.rules` allows a user to read and update only their own profile, rejects extra profile fields, prevents deletion, and denies all other Firestore access by default. `database.rules.json` restricts each presence connection to its owner. `storage.rules` restricts files to that user's `users/{uid}/` path, a 20 MiB limit, and an explicit MIME allowlist. Storage rules validate declared metadata, not file bytes; a future upload-processing route must validate file signatures itself. No file-upload UI is enabled yet.

## Current site

- Server-rendered landing and information pages (nonce-based CSP requires per-request HTML rendering; static assets remain cacheable)
- Google and email/password Firebase sign-in, password reset, and private profile persistence (requires Firebase setup)
- Owner-only Firestore, Realtime Database presence, and Storage rules with default-deny behavior
- Responsive layout, keyboard focus treatment, and reduced-motion support
- Product overview, help guide, pricing information, and XyroAIDetect explainer
- Terms, Privacy, and Acceptable Use drafts marked for legal review
- Metadata, Open Graph artwork, JSON-LD, sitemap, robots, manifest, and offline information page
- Chat, file upload, image generation, payment, detector, and XyroSocial sign-in are not currently available

The site copy describes planned product behavior where applicable. It is not evidence that those features or data controls are implemented.

## Configuration and secrets

Firebase web configuration is required for account sign-in and profile storage; `NEXT_PUBLIC_FIREBASE_DATABASE_URL` is also required for Realtime Database presence. `.env.example` lists these public web configuration values and placeholders for planned integrations. Configure secrets only in the server/deployment environment—never in `NEXT_PUBLIC_*` variables.

The planned integrations will require, at minimum:

- `OPENROUTER_API_KEY` for server-side model requests
- Firebase Web App configuration for current sign-in; Firebase Admin credentials are reserved for future server routes
- `MARK_KEY` and `MARK_SERVICE_SECRET` for server-side watermark operations

Do not add real credentials to this repository. Xyro AI is standalone; no shared XyroSocial domain, Firebase project, user collection, or SSO credentials have been provided.

## Security and deployment status

The current Next.js configuration adds browser security headers. Authentication uses Firebase's client SDK, Firestore profile rules, and owner-only Realtime Database presence rules; no Firebase Admin routes, model routes, upload handlers, rate limits, audit logs, payment integrations, or operational health checks are implemented yet.

The legal pages are drafts. Governing law, the legal operator, privacy contact, final data retention periods, and provider disclosures remain unspecified and require review before launch. The static site does not set non-essential cookies.

The Vercel Rust runtime is currently documented as beta. Before adopting it for image processing, measure the compiled artifact size, cold starts, memory, execution time, and the watermark robustness targets on the actual deployment configuration.

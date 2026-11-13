# Xyro AI

Xyro AI is an independent product concept. This repository currently contains a statically generated marketing and information site; the authenticated AI application and its service integrations are not implemented yet.

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

Copy `.env.example` to `.env.local` for local configuration. The marketing site needs no secrets; `SITE_URL` is the only variable used by the current application code. Leave it empty locally to use the default canonical origin.

## Deploy to Vercel

Vercel detects Next.js automatically; no custom `vercel.json` is required. Import the Git repository into Vercel and deploy with the default Next.js build settings. `package.json` constrains the build runtime to Node.js 22.x.

Set `SITE_URL` in the Vercel project settings to the canonical production origin (for example, `https://your-domain.example`). Preview deployments use Vercel's generated preview URL and are marked `noindex`. Environment-variable changes apply to new deployments, so redeploy after updating them.

The other entries in `.env.example` are reserved for planned integrations and are not used by the current site. Do not configure or expose secrets until the related server-side features exist. When needed, add private keys in Vercel as Secret variables; only Firebase web configuration belongs in `NEXT_PUBLIC_FIREBASE_*`. Never use the `NEXT_PUBLIC_` prefix for OpenRouter, Firebase Admin, or watermark secrets.

## Current site

- Static, server-rendered landing and information pages
- Responsive layout, keyboard focus treatment, and reduced-motion support
- Product overview, help guide, pricing information, and XyroAIDetect explainer
- Terms, Privacy, and Acceptable Use drafts marked for legal review
- Metadata, Open Graph artwork, JSON-LD, sitemap, robots, manifest, and offline information page
- No account, chat, upload, image generation, payment, detector, or XyroSocial sign-in is currently available

The site copy describes planned product behavior where applicable. It is not evidence that those features or data controls are implemented.

## Configuration and secrets

No runtime secrets are required for the current site. `.env.example` documents the planned integration variables. Configure secrets only in the server/deployment environment—never in `NEXT_PUBLIC_*` variables.

The planned integrations will require, at minimum:

- `OPENROUTER_API_KEY` for server-side model requests
- Firebase client configuration and Firebase Admin credentials
- `MARK_KEY` and `MARK_SERVICE_SECRET` for server-side watermark operations

Do not add real credentials to this repository. Xyro AI is standalone; no shared XyroSocial domain, Firebase project, user collection, or SSO credentials have been provided.

## Security and deployment status

The current Next.js configuration adds basic browser security headers. There are no Firebase rules, authentication routes, model routes, upload handlers, rate limits, audit logs, payment integrations, or operational health checks in this initial site.

The legal pages are drafts. Governing law, the legal operator, privacy contact, final data retention periods, and provider disclosures remain unspecified and require review before launch. The static site does not set non-essential cookies.

The Vercel Rust runtime is currently documented as beta. Before adopting it for image processing, measure the compiled artifact size, cold starts, memory, execution time, and the watermark robustness targets on the actual deployment configuration.

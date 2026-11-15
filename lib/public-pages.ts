// Content for the public information pages served by app/[slug].
//
// Everything here is written to match the product as implemented:
// free OpenRouter models only, Firebase Auth/Firestore/Realtime
// Database, private Cloudinary uploads, Turnstile-gated server
// sessions, and the Settings controls that actually exist. Paragraphs
// support [label](/path) markdown-style links; consecutive paragraphs
// starting with "- " render as a bullet list.

export type ArticleSection = { title: string; body: string[] };
export type ArticleCard = { title: string; href: string; blurb: string };
export type ArticleFaq = { q: string; a: string };

export type Article = {
  title: string;
  intro: string;
  updated?: string;
  cards?: ArticleCard[];
  faqs?: ArticleFaq[];
  sections: ArticleSection[];
};

export const articles: Record<string, Article> = {
  about: {
    title: "A thoughtful place to work with AI.",
    intro:
      "Xyro AI is a free AI chat workspace. It pairs OpenRouter's free models with a calm, ChatGPT-class interface, private file handling, and honest limits — no paid tier, no card, no dark patterns.",
    sections: [
      {
        title: "Start with the work",
        body: [
          "A good tool should meet you where your work is: in a half-formed question, a document you need to understand, or an idea you want to explore.",
          "Xyro AI brings conversation, model choice, and file analysis into one workspace. The goal is not to replace your judgment, but to help you put it to work sooner. Ask naturally, follow up, attach a file when words aren't enough, and stop or regenerate a reply whenever it drifts.",
        ],
      },
      {
        title: "Free as a design decision",
        body: [
          "Xyro AI runs entirely on free tiers: OpenRouter's free model pool for answers, Firebase for accounts and data, Cloudinary for private media storage, Upstash for rate limiting, Cloudflare Turnstile for abuse protection, and Vercel for hosting.",
          "That choice has honest consequences. Free models can be busy, free quotas are shared, and fair-use limits apply (see [pricing](/pricing)). We would rather explain those limits plainly than quietly degrade the experience or invent a paid plan that doesn't exist.",
        ],
      },
      {
        title: "Honest about the limits",
        body: [
          "AI systems can make mistakes, omit context, or sound certain when they are wrong. Xyro AI says so in the product, in the [FAQ](/faq), and in these pages — and gives you the controls to check, export, and delete your work.",
          "Xyro AI is an independent product. It does not share sign-in, accounts, or data with any other service.",
        ],
      },
      {
        title: "Built with care",
        body: [
          "Privacy, clear controls, and responsible use are part of the product from the start, not a later add-on. Read the [privacy notice](/privacy), the [security overview](/security), and the [acceptable use policy](/acceptable-use) for the details.",
        ],
      },
    ],
  },
  company: {
    title: "XyroBase and its products",
    intro:
      "XyroBase is the small product studio behind Xyro AI. This page describes the studio's products and how they relate to each other.",
    sections: [
      {
        title: "Xyro AI",
        body: [
          "Xyro AI is a free conversational AI workspace. It provides text conversations using OpenRouter's free model pool, chat history that syncs through Firestore, live-streamed replies through Realtime Database, private file attachments stored in Cloudinary, and image creation from the same free model pool — available whenever a free image model is in the catalogue. See the [changelog](/changelog) for what has shipped.",
        ],
      },
      {
        title: "XyroAIDetect",
        body: [
          "[XyroAIDetect](/xyroaidetect) is the companion provenance project for images created by Xyro AI: it explains the invisible watermark Xyro AI embeds in every generated image and — just as importantly — the limits of detecting it. Its results are intended to be informative, never definitive proof of origin.",
        ],
      },
      {
        title: "Independent products",
        body: [
          "Each XyroBase product has separate accounts, data systems, and terms. This Xyro AI site is standalone: it does not share sign-in or a Firebase project with any other product, and your Xyro AI data stays in Xyro AI until you export or delete it.",
        ],
      },
      {
        title: "Contact",
        body: [
          "Questions about the studio or its products? Use the [contact page](/contact).",
        ],
      },
    ],
  },
  pricing: {
    title: "Free. Actually free.",
    intro:
      "Xyro AI has one plan and it costs nothing. There is no paid tier, no subscription, no checkout, and no card on file — the service is built entirely on free tiers, and this page explains what that means in practice.",
    sections: [
      {
        title: "What you get",
        body: [
          "- Unlimited accounts: one per person, created with email/password or Google sign-in",
          "- Chat with any model OpenRouter currently offers for free, or Auto (Free) routing",
          "- File uploads and analysis: images, PDF, TXT, Markdown and CSV, up to 10 MB per file and five files per message",
          "- Image creation from the chat composer, whenever a free image model is available (10 creations per day), with an invisible watermark on every created picture",
          "- Chat history synced across your devices, with search, rename, export and delete",
          "- Custom instructions, model defaults, and a full settings suite",
          "- Data export (JSON and Markdown) and full account deletion, self-serve from Settings",
        ],
      },
      {
        title: "Why it can be free",
        body: [
          "Every part of the stack is a free tier: OpenRouter's free models, Firebase's Spark plan (Auth, Firestore, Realtime Database), Cloudinary's free media tier, Upstash Redis free, Cloudflare Turnstile, and Vercel Hobby hosting. Xyro AI only ever calls models whose price is zero, so there is no per-message bill to pass on to you.",
        ],
      },
      {
        title: "Fair-use limits (the honest trade-off)",
        body: [
          "Free tiers have quotas, so Xyro AI applies fair-use limits to keep the service available for everyone:",
          "- Chat: up to 10 messages per minute and 60 per day per account",
          "- New chats: up to 30 per day; uploads are rate-limited per hour",
          "- Data export: once per day; delete-all-chats: up to three runs per day",
          "- When the whole service approaches its daily free-tier budget, new chat messages may briefly queue (you'll see a queued state and an automatic retry), and at the hard ceiling chat pauses until the next day rather than failing mid-conversation",
          "Free models themselves are shared pools run by their providers: at peak times a model can be slow or temporarily unavailable, and the catalogue of free models changes over time. The in-app model picker always shows the current list.",
        ],
      },
      {
        title: "No paid plans",
        body: [
          "There is no Pro plan, no credits system, and no payment provider connected to this site. If that ever changes, prices, limits and billing terms will be published here before anything is sold — and the free tier described on this page is the product as it exists today.",
          "Questions about pricing or limits? Use the [contact page](/contact).",
        ],
      },
    ],
  },
  faq: {
    title: "Frequently asked questions",
    intro:
      "Short, honest answers about cost, models, files, privacy and accounts. For step-by-step guides, visit the [help center](/help).",
    sections: [],
    faqs: [
      {
        q: "Is Xyro AI really free?",
        a: "Yes. There is no paid plan, no subscription and no payment flow. Xyro AI runs on free tiers (OpenRouter free models, Firebase Spark, Cloudinary, Upstash, Cloudflare Turnstile, Vercel Hobby). The trade-off is fair-use limits, explained on the pricing page.",
      },
      {
        q: "Which AI models can I use?",
        a: "Any model OpenRouter currently lists as free. Choose Auto (Free) to let OpenRouter route each prompt to an available free model, or pick a specific model in the chat model picker or in Settings → General. The free catalogue changes as providers adjust it; the in-app list is always current.",
      },
      {
        q: "Can AI get things wrong?",
        a: "Yes — often confidently. Models can produce incomplete, outdated or incorrect responses. Check important facts with reliable sources, especially before consequential decisions, and don't treat output as medical, legal, financial or other professional advice.",
      },
      {
        q: "What files can I upload, and what happens to them?",
        a: "Images (JPG, PNG, WebP, GIF) and documents (PDF, TXT, Markdown, CSV), up to 10 MB each and five per message. Files are stored as private, authenticated Cloudinary assets. Image files are analysed by vision-capable free models; document text is extracted into the conversation. Files are deleted when you delete the chat, the file, or your account.",
      },
      {
        q: "Can Xyro AI create images?",
        a: "Yes — open a chat, use the + menu's 'Create an image', and describe the picture. Creation uses free image-capable OpenRouter models only, applies an invisible watermark before the image is stored in Cloudinary, and is limited to 10 creations per day. Free image models come and go from the catalogue: if none is available at a given moment, the app says so clearly rather than faking a result.",
      },
      {
        q: "Why do I need to verify my email?",
        a: "Verification keeps the free service usable: chat and uploads require a verified email so automated abuse can't burn the shared free quotas. Unverified accounts can still sign in, manage settings, and resend the verification email.",
      },
      {
        q: "What is the human check (Turnstile) for?",
        a: "Cloudflare Turnstile helps keep bots from creating accounts and burning the shared free tiers. In Xyro AI it gates your server session — not just the sign-in form — so product access can't be obtained without it.",
      },
      {
        q: "Is my data used to train AI models?",
        a: "Xyro AI does not train models. To answer you, prompts and relevant file content are sent to OpenRouter and the selected free model provider, which process them under their own policies. Don't submit sensitive information. The privacy notice has the full data-flow picture.",
      },
      {
        q: "How do I export or delete my data?",
        a: "Settings → Data controls exports your chats and account data (JSON and Markdown) and can delete all chats or individual uploaded files. Settings → Account deletes your entire account. The privacy center walks through every control.",
      },
      {
        q: "I can't sign in. What should I check?",
        a: "Make sure your email is verified, try the password reset on the sign-in page, and check the troubleshooting guide in the help center. If a session was revoked (for example after signing out of all devices), sign in again to create a fresh one.",
      },
      {
        q: "Does Xyro AI have a public API?",
        a: "Yes — an OpenAI-compatible API under /api/v1. Activate it in Settings → Developer to get a key; the free plan includes 100,000 tokens per day. The other endpoints under /api are the web app's own and require your signed-in session. The developers page has the details and the API terms govern use.",
      },
    ],
  },
};

Object.assign(articles, {
  help: {
    title: "How can we help?",
    intro:
      "Guides for getting started, working with files, managing chats and your account, and fixing sign-in problems. Everything here describes the product as it works today.",
    cards: [
      { title: "Getting started", href: "/help-getting-started", blurb: "Create an account, verify your email, and send your first message." },
      { title: "Uploading & analysing files", href: "/help-files", blurb: "Supported formats, limits, privacy, and how analysis works." },
      { title: "Image creation", href: "/help-image-creation", blurb: "How to create images, the free-model rule, limits, and how the invisible watermark works." },
      { title: "Managing chats", href: "/help-managing-chats", blurb: "Rename, search, export, delete, stop and regenerate." },
      { title: "Account & settings", href: "/help-account-settings", blurb: "Profile, theme, models, custom instructions, sessions and more." },
      { title: "Privacy & your data", href: "/help-privacy-data", blurb: "What is stored where, export and deletion, and provider data flows." },
      { title: "Troubleshooting sign-in", href: "/help-sign-in", blurb: "Verification, password resets, sessions, and the human check." },
    ],
    sections: [
      {
        title: "Still stuck?",
        body: [
          "If a guide doesn't solve it, the [FAQ](/faq) answers the most common questions, and you can always reach us through the [contact page](/contact). Please don't include passwords or sensitive personal data in support messages.",
        ],
      },
    ],
  },
  "help-getting-started": {
    title: "Getting started with Xyro AI",
    intro:
      "From a fresh account to a useful first conversation in a few minutes — including the two steps people most often miss: the human check and email verification.",
    sections: [
      {
        title: "1. Create your account",
        body: [
          "Open the sign-up page and register with an email address and password, or use Google sign-in. A Cloudflare Turnstile human check runs as part of sign-up; it usually completes invisibly, and occasionally asks for a quick interaction. Passwords are checked against known breach lists using a privacy-preserving k-anonymity lookup — your password itself is never sent to the checker.",
          "If the human check fails or expires, the form says so and offers a retry. Expired checks are the most common cause of a 'try again' message on sign-up.",
        ],
      },
      {
        title: "2. Verify your email",
        body: [
          "After sign-up we email you a verification link. You can sign in and look around before verifying, but sending chat messages and uploading files require a verified address — this protects the shared free quotas from automated abuse.",
          "Didn't get the email? Open any page in the app and use the resend button in the verification banner (it has a 60-second cooldown), and check your spam folder. Signed in with Google? Your address is already verified.",
        ],
      },
      {
        title: "3. Send your first message",
        body: [
          "Choose New chat (or just start typing). Write your question in the composer and press Enter to send — Shift+Enter adds a new line. If you've changed the send-key setting, Cmd/Ctrl+Enter sends instead.",
          "Replies stream in live. Use the stop button (or Escape) to halt a reply that's going the wrong way, and Regenerate to retry the last exchange. A small set of starter suggestions appears on an empty chat; you can turn them off in Settings → General.",
        ],
      },
      {
        title: "4. Choose a model",
        body: [
          "The model picker in the chat top bar defaults to Auto (Free): OpenRouter routes your prompt to an available free model. Pick a named free model when you want a specific one — for example a vision-capable model before attaching images. If your pick is busy, chat falls back to Auto (Free) once and tells you. Set a different default in Settings → General.",
        ],
      },
      {
        title: "5. Make it yours",
        body: [
          "Settings → Personalization lets you add custom instructions — what Xyro AI should know about you and how it should respond — which are included in every chat while the switch is on. Settings → General controls the theme (system, dark or light), typing speed, and send key.",
        ],
      },
    ],
  },
  "help-files": {
    title: "Uploading & analysing files",
    intro:
      "Attach images and documents to a chat and ask questions about them. This guide covers what's supported, how analysis works, and exactly where your files live.",
    sections: [
      {
        title: "Supported files and limits",
        body: [
          "- Images: JPG, PNG, WebP, GIF",
          "- Documents: PDF, TXT, Markdown (.md), CSV",
          "- Up to 10 MB per file, and up to five files per message",
          "- File contents are verified on the server by their actual bytes (magic-byte and UTF-8 checks), not just the file name — a renamed file of the wrong type is rejected",
          "Attach files with the + button in the composer, review the chips, then send. You must have a verified email to upload.",
        ],
      },
      {
        title: "How analysis works",
        body: [
          "Images are analysed by a vision-capable free model: if the model you picked can't see images, Xyro AI automatically routes the conversation to a free vision model from the catalogue — and if none is available, the reply will tell you the images couldn't be viewed rather than ignoring them. For documents (PDF, TXT, Markdown, CSV), the text is extracted on Xyro AI's own server from your stored file and included in the conversation context, so the model answers from the document's actual contents. Up to 60,000 characters of extracted text are included per request; a PDF with no text layer (a scan of images) can't be read this way — attach page images instead.",
          "Very long documents may be truncated to fit the model's context window, and free models vary in how faithfully they read dense tables or scans. For anything consequential, cross-check the answer against the source document.",
        ],
      },
      {
        title: "Where files are stored",
        body: [
          "Files upload directly from your browser to Cloudinary using signed, short-lived parameters, and are stored as authenticated (private) assets — there is no public link. When you or the model needs a file, the server issues a temporary access URL.",
          "Files belong to the chat you attached them in. Delete a single file from Settings → Data controls, or delete the chat, and its files are deleted from Cloudinary too. Deleting your account deletes everything.",
        ],
      },
      {
        title: "Stay safe",
        body: [
          "File contents you attach are sent to OpenRouter and the selected model provider so the model can analyse them, and those providers process data under their own policies. Don't upload sensitive personal, financial, health or identification documents. See [privacy & your data](/help-privacy-data).",
        ],
      },
    ],
  },
  "help-image-creation": {
    title: "Image creation",
    intro:
      "Describe a picture and Xyro AI creates it in your chat — using free image models only, with an invisible watermark applied before the image is stored. This page explains how it works, the limits, and the one situation where creation is honestly unavailable.",
    sections: [
      {
        title: "How to create an image",
        body: [
          "Open a chat and tap the + button in the composer, then choose 'Create an image'. The composer switches to creation mode: describe the picture you want and send. Your description appears as a message, and the created picture arrives as the reply, attached to the conversation like an uploaded image.",
          "You need a verified email to create images, just like sending messages. Creation is limited to 10 pictures per account per day — a fair-use limit that protects the shared free tiers.",
        ],
      },
      {
        title: "The free-model rule — and when creation is unavailable",
        body: [
          "Creation uses free image-capable models from OpenRouter only — the same free-only rule as chat, checked against the live catalogue at the moment you ask. Free image models come and go: providers add and remove them, and there are periods when no image model is free at all.",
          "When that happens, the app says so plainly — 'Image creation isn't available right now because no free image model is currently available — please try again later' — instead of faking a result, silently substituting something else, or ever calling a paid model. Trying again later is genuinely the fix: availability follows the catalogue.",
        ],
      },
      {
        title: "Where created pictures live",
        body: [
          "Before delivery, every created picture passes through a server-side invisible watermarking step, and the watermarked image is what gets stored — the unwatermarked original is not kept. Pictures are stored as private, authenticated Cloudinary media under your account, appear in your chat and in Settings → Data controls alongside your uploaded files, and are deleted with the chat, the file, or your account.",
        ],
      },
      {
        title: "About the watermark",
        body: [
          "The invisible watermark is a provenance signal embedded in the image's pixel data (a payload naming Xyro AI, the generation, and a hash of the account — never your email or name): it helps [XyroAIDetect](/xyroaidetect) recognise images that came from Xyro AI. Like all watermarking, it can be weakened or removed by heavy editing, cropping, screenshots or re-generation — a missing mark never proves an image is human-made, and a present mark is a signal, not proof. The [acceptable use policy](/acceptable-use) prohibits removing or circumventing it.",
        ],
      },
    ],
  },
  "help-managing-chats": {
    title: "Managing chats",
    intro:
      "Your conversations live in the sidebar, synced to your account. Rename them, search them, export them, or delete them — individually or all at once.",
    sections: [
      {
        title: "Organising the sidebar",
        body: [
          "Chats are grouped by recency (Today, Previous 7 days, Older). Use the search box to filter by title, and the … menu on any chat to rename, export or delete it. Renaming is worth it for anything you'll want to find again — the automatic title comes from your first message.",
        ],
      },
      {
        title: "During a conversation",
        body: [
          "- Stop: halt a streaming reply (button or Escape) — the partial reply stays in the chat",
          "- Regenerate: re-run the last exchange, useful when a reply misses the point",
          "- Copy: every reply and code block has a copy action; code blocks show their language",
          "- Model picker: switch models mid-conversation from the top bar; the choice is remembered per device",
          "If a stream stalls, the app falls back to the final saved message automatically — you won't lose a reply to a dropped connection.",
        ],
      },
      {
        title: "Exporting",
        body: [
          "Export a single chat from its … menu, or export everything — chats plus account data — from Settings → Data controls, in JSON and Markdown. Full exports are limited to once per day (a free-tier protection) and cover up to 2,000 documents.",
        ],
      },
      {
        title: "Deleting",
        body: [
          "Deleting a chat removes its messages from Firestore, its live-stream data, and its uploaded files from Cloudinary. Settings → Data controls can delete all chats at once (you'll type DELETE to confirm; up to three runs per day). Deletion is permanent — export first if you might want the content later.",
        ],
      },
    ],
  },
  "help-account-settings": {
    title: "Account & settings",
    intro:
      "Everything about you lives under Settings, in seven tabs. Changes save automatically with a short debounce, and every control there does what it says — there are no placeholder settings.",
    sections: [
      {
        title: "Profile",
        body: [
          "Change your display name, upload an avatar (it's cropped square and stored in Cloudinary), and see your sign-in email and verification status, with a resend button for the verification email.",
        ],
      },
      {
        title: "General",
        body: [
          "Theme (system, dark or light — applied instantly and synced to your account), typing speed for streamed replies, whether Enter or Cmd/Ctrl+Enter sends, whether suggestions show on an empty chat, and your default model.",
        ],
      },
      {
        title: "Personalization",
        body: [
          "Custom instructions: two fields of up to 1,500 characters each — what Xyro AI should know about you, and how it should respond — plus an on/off switch. While on, they're added to every chat as context. Turn the switch off to keep the text but stop sending it.",
        ],
      },
      {
        title: "Data controls",
        body: [
          "Export all your data, review and delete uploaded files, and delete all chats. See [privacy & your data](/help-privacy-data) for what each action covers.",
        ],
      },
      {
        title: "Security",
        body: [
          "Change your password (you'll re-authenticate, and new passwords are breach-checked and must be at least 10 characters), see your sign-in methods, and review your active sessions — device, approximate location, last active — with the power to revoke any single session or sign out of all other devices. Revoking a session ends its API access immediately.",
        ],
      },
      {
        title: "Usage",
        body: [
          "See how much of your daily chat allowance and the service's daily budget you've used, and when limits reset. Xyro AI is free, so there's no balance or billing here — just the fair-use counters from the [pricing](/pricing) page.",
        ],
      },
      {
        title: "Account",
        body: [
          "Product version and links to the legal pages, sign out (this device or all devices, always with a confirmation), and account deletion. Deleting your account is staged and resumable: it removes your chats, files, settings and finally your sign-in identity, and clears your session.",
        ],
      },
    ],
  },
  "help-privacy-data": {
    title: "Privacy & your data",
    intro:
      "A plain-language map of what Xyro AI stores, where it lives, who else processes it, and the controls you have. The formal version is the [privacy notice](/privacy); your hands-on controls are collected in the [privacy center](/privacy-center).",
    sections: [
      {
        title: "What is stored, and where",
        body: [
          "- Account: Firebase Authentication holds your email, password (hashed by Firebase) or Google identity, and your verification status",
          "- Profile and settings: Firestore holds your display name, avatar URL, preferences and custom instructions",
          "- Chats: Firestore holds your conversations and messages; Realtime Database holds only presence and in-progress reply text, which is removed when generation finishes",
          "- Files: Cloudinary holds your uploads as private, authenticated assets",
          "- Sessions: Firestore holds a record per signed-in session (device label, approximate city/country from request headers, last active time); Upstash Redis holds rate-limit counters and session-revocation keys",
          "- Device security: at sign-in your browser computes a device fingerprint (from browser and screen characteristics) and sends only its SHA-256 hash; Firestore stores that hash with your sessions, a per-account device list (first/last seen, sign-in count) and a security activity feed, and your IP address is stored only as a keyed hash — never in plain text. This powers the device list and new-device badges in Settings → Security and helps detect abusive sign-ups; it is never used for advertising or cross-site tracking",
          "- Developer API (only if you activate it): Firestore stores your activation answers (project name, use case, builder type, language, optional website), your API keys as SHA-256 hashes (the full key is shown once and never stored), daily token-usage totals, and a per-request log with the model used, token counts and a request fingerprint (browser/device label and keyed IP hash) — visible to you in Settings → Developer",
        ],
      },
      {
        title: "Who else processes your data",
        body: [
          "To generate a reply, your prompt, conversation context and any relevant file content are sent to OpenRouter and the free model provider that serves the request. Those providers process data under their own terms and may retain it under their settings — Xyro AI can't delete data from a provider's systems, so don't send sensitive information. The full list of processors is on the [subprocessors](/subprocessors) page.",
        ],
      },
      {
        title: "Your controls",
        body: [
          "- Export: Settings → Data controls downloads your chats and account data (JSON + Markdown), once per day",
          "- Delete chats: per chat from the sidebar, or all chats from Data controls",
          "- Delete files: individually from Data controls",
          "- Delete account: Settings → Account removes everything, including your sign-in identity",
          "- Sessions: Settings → Security revokes any session, on any device",
          "- Custom instructions: Settings → Personalization — turn them off or clear them any time",
        ],
      },
      {
        title: "What deletion can't reach",
        body: [
          "Deleting data in Xyro AI removes it from Firebase and Cloudinary. It cannot recall prompts or file content already processed by an external model provider; that data is governed by the provider's own retention policy. This is the strongest reason to keep sensitive material out of chats and uploads.",
        ],
      },
    ],
  },
  "help-sign-in": {
    title: "Troubleshooting sign-in",
    intro:
      "Most sign-in problems come down to four things: email verification, the human check, password state, or a revoked session. Work through the matching section below.",
    sections: [
      {
        title: "'Verify your email' — but I did",
        body: [
          "Verification links can be opened on a different device or browser than the one you're signed in on. After clicking the link, return to the app and use 'I've verified — refresh status' in the banner or your profile. If the banner persists, sign out and back in once so the app picks up a fresh token.",
        ],
      },
      {
        title: "No verification email",
        body: [
          "Check spam and promotions folders first. Then use the resend button in the verification banner (60-second cooldown between sends) or in Settings → Profile. If you signed up with a typo'd address, the email can never arrive — create the account again with the correct address.",
        ],
      },
      {
        title: "The human check keeps failing or expiring",
        body: [
          "Turnstile tokens are single-use and short-lived: if a form sat open for several minutes, or a previous attempt consumed the token, the check shows 'expired' and offers a retry — use it rather than resubmitting the stale form. Browser extensions that block third-party scripts, and VPNs with heavily flagged exit nodes, can also interfere; try an unfiltered window.",
        ],
      },
      {
        title: "Forgot or rejected password",
        body: [
          "Use 'Forgot password' on the sign-in page: the reset flow is itself protected by the human check, and the response is deliberately generic — it won't confirm whether an address has an account. New passwords must be at least 10 characters (12+ at sign-up when the breach-check service is unavailable) and are screened against known breaches.",
        ],
      },
      {
        title: "Signed out unexpectedly",
        body: [
          "Sessions end when you sign out, when a session is revoked in Settings → Security, when you sign out of all devices, or after a password change on another device. They also expire after 90 days at most. Network problems and token-refresh errors never sign you out by themselves — if you're suddenly at the sign-in page with a 'session revoked' message, check Settings → Security on a still-signed-in device, and change your password if you don't recognise the activity.",
        ],
      },
      {
        title: "Google sign-in issues",
        body: [
          "Google sign-in opens a popup; if nothing appears, allow popups for this site. After Google confirms you, the app exchanges that for a Xyro AI session — if you're returned to sign-in with a 'one more step' prompt, complete the human check shown and the sign-in will finish.",
        ],
      },
    ],
  },
});

Object.assign(articles, {
  contact: {
    title: "Get in touch.",
    intro:
      "Questions about Xyro AI, your account, or these policies? Here's how to reach the right place.",
    sections: [
      {
        title: "Product and general questions",
        body: [
          "Email [hello@xyro.ai](mailto:hello@xyro.ai) with a short description of what you need. Please do not include passwords, verification codes, payment information, or sensitive personal data — we will never ask for them.",
          "Before writing, the [help center](/help) and [FAQ](/faq) answer most questions, including sign-in problems and data controls.",
        ],
      },
      {
        title: "Privacy and data requests",
        body: [
          "Most privacy actions are self-serve and instant: export, delete chats or files, revoke sessions, and delete your account, all from Settings (see the [privacy center](/privacy-center)). For anything those controls don't cover, email [hello@xyro.ai](mailto:hello@xyro.ai) with 'Privacy' in the subject line.",
        ],
      },
      {
        title: "Security reports",
        body: [
          "Found a vulnerability? Email [hello@xyro.ai](mailto:hello@xyro.ai) with 'Security' in the subject line and enough detail to reproduce it. Please don't open public issues for vulnerabilities, and give us reasonable time to fix before disclosing. The [security page](/security) describes the model your report will land in.",
        ],
      },
      {
        title: "Response times",
        body: [
          "Xyro AI is a small, free product; we read everything but can't guarantee a response time. Never use this address for emergencies.",
        ],
      },
    ],
  },
  changelog: {
    title: "What's changing",
    intro:
      "A record of meaningful product updates, newest first. Dates are when the change was completed.",
    sections: [
      {
        title: "November 15, 2026 · Image creation and deeper file analysis",
        body: [
          "Image creation arrived: the composer's + menu now has 'Create an image', which describes a picture, generates it with a free image model, embeds an invisible Xyro AI watermark before storage, and saves the result as private Cloudinary media in the chat. Creation is limited to 10 per day and follows the free-only rule honestly — when no free image model is in the catalogue, the app says so instead of faking a result. File analysis deepened too: PDF text is now extracted on our own server (no parsing plugins), and chats with image attachments are automatically routed to a vision-capable free model.",
        ],
      },
      {
        title: "November 15, 2026 · Pages, themes and polish",
        body: [
          "Rebuilt the landing page with a realistic workspace preview, a full feature tour, an honest models section and an FAQ teaser. Wrote out every public page in detail — help center with seven guides, FAQ, pricing, security, privacy center, subprocessors, status and developers pages. Converted the whole design to CSS variables and added a complete light theme with a System / Dark / Light control in Settings → General, applied before first paint.",
        ],
      },
      {
        title: "November 15, 2026 · Chat, rebuilt",
        body: [
          "ChatGPT-class chat interface: right-aligned message bubbles, markdown replies with code blocks and copy buttons, a + attach menu, per-chat menus (rename, export, delete), a live model picker fed by the free-model catalogue, and hardened live streaming with sequence checks and an automatic fallback to the saved message. Added a health endpoint and a Firebase configuration verifier.",
        ],
      },
      {
        title: "November 15, 2026 · Route hardening",
        body: [
          "Unified rate limiting across every API route, Origin and request-header checks on all mutations, server-side file-content validation (magic bytes and UTF-8, not just file names), and a daily free-tier budget guard that queues chat at 85% and pauses at 95% instead of failing mid-reply.",
        ],
      },
      {
        title: "November 15, 2026 · Settings, complete",
        body: [
          "Settings grew to seven fully working tabs: profile with avatar uploads, general (typing speed, send key, default model), personalization with custom instructions that actually reach the model, data controls with export and delete, security with password changes and per-session revocation, usage, and staged account deletion.",
        ],
      },
      {
        title: "November 15, 2026 · Sessions and sign-in",
        body: [
          "Turnstile now gates the server session itself: signed, revocable session cookies on top of Firebase sign-in, middleware redirects with validated return paths, a sign-out confirmation everywhere including sign-out-of-all-devices, and no more profile flash or login dead-ends for unverified users — they land in the app with a verification banner instead.",
        ],
      },
      {
        title: "November 14, 2026 · Chat and file storage",
        body: [
          "Added Firestore chat history, live response updates through Realtime Database, private Cloudinary uploads for images and common documents, chat search and deletion, stop and regenerate controls, and per-user capacity limits through Upstash Redis.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms of Service",
    updated: "Last updated · November 15, 2026",
    intro:
      "These terms describe the Xyro AI service as it operates today: a free AI chat workspace run by XyroBase. By creating an account or using the service, you agree to them.",
    sections: [
      {
        title: "1. The service and eligibility",
        body: [
          "Xyro AI provides text conversations with free AI models routed through OpenRouter, file upload and analysis, synced chat history, and account settings. The service is free; there are no paid plans, subscriptions or in-product purchases.",
          "You must be at least 18 years old to use Xyro AI. You are responsible for your account credentials and for activity under your account. One person, one account; automated account creation is prohibited and is actively blocked.",
        ],
      },
      {
        title: "2. AI-generated output",
        body: [
          "AI output can be wrong, incomplete, biased or out of date, including when it sounds confident. You are responsible for evaluating output and verifying important information before relying on it. Output is not medical, legal, financial or other professional advice.",
          "Subject to applicable law and third-party rights, you may use output from your conversations for your own purposes. You remain responsible for how you use, publish and act on it.",
        ],
      },
      {
        title: "3. Your content and files",
        body: [
          "You keep ownership of the messages and files you submit. You grant Xyro AI and its processors the limited permission needed to store, transmit and process that content to provide the service — including sending prompts and relevant file content to OpenRouter and the selected model provider, whose own terms also apply to that processing.",
          "Files are stored as private Cloudinary assets and are deleted when you delete the chat, the file, or your account. Don't upload content you don't have the right to use, or sensitive personal information.",
        ],
      },
      {
        title: "4. Images and watermarks",
        body: [
          "Created images carry an invisible Xyro AI watermark signal embedded before delivery. You must not remove, conceal or circumvent a watermark or provenance signal added by Xyro AI, except where applicable law grants a non-waivable right.",
          "No watermark or detector result guarantees that an image is AI-generated or unaltered; see [XyroAIDetect](/xyroaidetect) for the limits.",
        ],
      },
      {
        title: "5. Acceptable use, suspension and termination",
        body: [
          "Your use is subject to the [Acceptable Use Policy](/acceptable-use). We may rate-limit, suspend or terminate access to protect users, the free-tier quotas the service depends on, or to comply with law.",
          "You may stop using the service at any time, export your data from Settings → Data controls, and delete your account from Settings → Account. On termination, your data is handled as described in the [privacy notice](/privacy).",
        ],
      },
      {
        title: "6. Availability and changes",
        body: [
          "Xyro AI depends on free third-party tiers (OpenRouter model providers, Firebase, Cloudinary, Upstash, Vercel). Availability, model catalogues and quotas can change without notice, and fair-use limits may queue or pause chat at peak load. The service is provided 'as is' without warranties to the extent permitted by law.",
          "We may update these terms; material changes will be announced on this page with a new 'last updated' date. Continued use after a change takes effect means you accept the updated terms.",
        ],
      },
      {
        title: "7. Contact",
        body: [
          "Questions about these terms: see the [contact page](/contact).",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy Notice",
    updated: "Last updated · November 15, 2026",
    intro:
      "What Xyro AI collects, why, where it lives, who else processes it, and the controls you have. This notice describes the implemented product, and the [privacy center](/privacy-center) collects every control in one place.",
    sections: [
      {
        title: "1. Information we process",
        body: [
          "Account: Firebase Authentication stores your email address, your password (hashed by Firebase) or your Google identity, and whether your email is verified. Your profile document in Firestore holds your user ID, email, display name, avatar URL and account timestamps.",
          "Content: your chat messages are stored in Firestore under your account; replies stream through Realtime Database while generating and the temporary stream is removed when generation finishes. Files you attach (images, PDF, TXT, Markdown, CSV; up to 10 MB) are stored as authenticated, private assets in Cloudinary.",
          "Settings and sessions: your preferences and custom instructions live in Firestore, written only by our server. Each sign-in creates a session record (device label from your browser's user agent, approximate city/country from request headers, last-active time). Rate-limit counters and session-revocation keys live in Upstash Redis.",
          "Abuse prevention: account creation, sign-in and password reset are protected by Cloudflare Turnstile, which processes its challenge token and browser/network signals. Sign-up and password changes are screened against known password breaches using a k-anonymity lookup that never receives your password.",
        ],
      },
      {
        title: "2. AI providers",
        body: [
          "When you send a message, the service sends the conversation context needed for that reply — your prompt, recent messages, custom instructions if enabled, and relevant attached image or file content — to OpenRouter, which routes it to the free model provider you selected (or that Auto (Free) selected). Those providers process the content in plaintext to generate a response and handle it under their own terms and retention settings.",
          "Xyro AI does not train models on your content and does not sell personal data. Because external providers are involved, do not submit sensitive information — health, financial, identification or other confidential material — in chats or uploads.",
        ],
      },
      {
        title: "3. Storage and security",
        body: [
          "Product APIs require both a signed, HttpOnly server session cookie and a Firebase ID token for the same account; Firestore and Realtime Database rules restrict data to its owner, and clients cannot write chat data directly. Uploads are content-checked server-side by their actual bytes. Sessions can be revoked instantly, and sign-out-of-all-devices invalidates every session and refresh token.",
          "No system can promise perfect security; the [security page](/security) describes the model and its known residual risks honestly.",
        ],
      },
      {
        title: "4. Cookies and local storage",
        body: [
          "Xyro AI sets one essential cookie: the signed session cookie that keeps you signed in. Firebase Auth uses browser storage (IndexedDB/local storage) to keep your sign-in state on your device, and the app stores small functional values locally (your theme mirror and per-device model choice). There are no advertising or cross-site tracking cookies, and no cookie-consent banner is needed because nothing non-essential is set. Details are on the [cookies page](/cookies).",
        ],
      },
      {
        title: "5. Your controls: export and deletion",
        body: [
          "From Settings you can export your chats and account data (JSON and Markdown), delete individual chats and uploaded files, delete all chats, revoke sessions, and delete your entire account, which removes your Firestore data, Cloudinary files and finally your Firebase sign-in identity.",
          "Deletion inside Xyro AI cannot recall prompts or file content already processed by an external model provider; that data is governed by the provider's own retention policy.",
        ],
      },
      {
        title: "6. Age and contact",
        body: [
          "Xyro AI is intended for users aged 18 and over. For privacy questions or requests that the self-serve controls don't cover, use the [contact page](/contact). Material changes to this notice will be announced here with a new 'last updated' date.",
        ],
      },
    ],
  },
  "acceptable-use": {
    title: "Acceptable Use Policy",
    updated: "Last updated · November 15, 2026",
    intro:
      "The rules for using Xyro AI. They exist to keep a free, shared service safe and available for everyone.",
    sections: [
      {
        title: "Use the service lawfully and responsibly",
        body: [
          "Do not use Xyro AI to violate the law, infringe others' rights, threaten or harass people, facilitate violence or wrongdoing, exploit minors, or create deceptive material for harmful purposes.",
          "Do not attempt to bypass access controls, the human check, email verification or rate limits; do not scrape or automate the product's internal APIs; and do not interfere with service availability or access another person's data. The free tiers are shared — abuse that burns shared quotas harms every user.",
        ],
      },
      {
        title: "Respect provenance signals",
        body: [
          "Do not remove, obscure or circumvent the invisible watermarks that Xyro AI adds to generated images, except where applicable law provides a non-waivable right. Do not present detector output as conclusive proof of an image's origin.",
          "Watermarking and detection can fail after editing, compression, cropping, screenshots or re-generation. A missing mark does not establish that an image is human-created.",
        ],
      },
      {
        title: "Protect sensitive information",
        body: [
          "Do not provide sensitive personal information — your own or anyone else's — in chats or uploads. Prompts and file content are processed by external model providers (see the [privacy notice](/privacy)), and the service is not designed for health, financial, legal or identification data.",
        ],
      },
      {
        title: "AI limitations",
        body: [
          "AI-generated answers may be inaccurate or unsafe. Review and verify output before relying on or sharing it, particularly in high-impact contexts.",
        ],
      },
      {
        title: "Reporting and enforcement",
        body: [
          "Report misuse via the [contact page](/contact). Violations may lead to rate limiting, suspension or termination under the [terms](/terms). The intended minimum age for the service is 18.",
        ],
      },
    ],
  },
  cookies: {
    title: "Cookies & local storage",
    intro:
      "Xyro AI uses exactly one essential cookie and a small amount of functional browser storage. There are no advertising, analytics or cross-site tracking cookies, which is why this site shows no cookie-consent banner.",
    sections: [
      {
        title: "The session cookie",
        body: [
          "Name: __Host-xyro_session (a plain xyro_session name is used for local development over HTTP). It is a signed JWT set by our server after sign-in, marked HttpOnly, Secure and SameSite=Lax, so scripts cannot read it and it is only sent back to this site.",
          "It slides forward as you use the app (30-day window) with a 90-day absolute maximum, and it is cleared on sign-out. Revoked sessions are refused even before expiry. Without this cookie the product APIs return 401 — it is strictly necessary for the service you asked to use.",
        ],
      },
      {
        title: "Firebase sign-in storage",
        body: [
          "Firebase Authentication stores your sign-in state in your browser (IndexedDB, with local storage fallback) so you stay signed in between visits and tokens can refresh. This storage is set by the Firebase SDK on this site's origin only, and it is removed when you sign out — Xyro AI's sign-out also terminates the local Firestore connection and clears its offline cache.",
        ],
      },
      {
        title: "Functional local storage",
        body: [
          "- Theme mirror: your System / Dark / Light preference, mirrored locally so the right theme paints before the app loads (the saved preference itself lives in your account settings)",
          "- Model choice: the model you last picked in chat, remembered per device",
          "- A one-time flag used to reload the page once if a stale code chunk fails to load after a deployment",
          "None of these identify you across sites or are shared with anyone.",
        ],
      },
      {
        title: "Third parties",
        body: [
          "Cloudflare Turnstile runs in an iframe from challenges.cloudflare.com during sign-in, sign-up and password reset, and may set its own cookies within that iframe to run the human check. Google sign-in similarly uses Google's own cookies inside its popup flow. Xyro AI does not control those cookies; Cloudflare's and Google's policies describe them.",
        ],
      },
      {
        title: "Your controls",
        body: [
          "Blocking the session cookie or Firebase storage will sign you out and prevent sign-in — the service cannot work without them. You can clear site data for this origin in your browser at any time; signing out from Settings → Account (or the header menu) also ends the server session, which clearing cookies alone does not do.",
        ],
      },
    ],
  },
});

Object.assign(articles, {
  "api-terms": {
    title: "API Terms",
    updated: "Last updated · November 15, 2026",
    intro:
      "Xyro AI does not offer a public API. These terms govern the product's own endpoints and any automated access to the service.",
    sections: [
      {
        title: "The public API",
        body: [
          "Xyro AI offers a public API under /api/v1 for account holders who activate developer access in [Settings → Developer](/settings/developer). API keys are the only supported credential for programmatic access. The free plan includes 100,000 tokens per day; keys can be revoked at any time and revoked keys fail immediately. The remaining endpoints under /api exist solely to serve the Xyro AI web app and are not part of the public API. The [developers page](/developers) documents the endpoints.",
        ],
      },
      {
        title: "Authentication is personal",
        body: [
          "Every web-app endpoint requires a signed server session cookie issued to a signed-in person after a Turnstile human check, plus a Firebase ID token for the same account. Sharing, selling, pooling or scripting sessions — including your own — is prohibited. API keys are likewise personal to the account that created them: do not share, sell or pool keys, and keep them secret — anyone holding a key can spend that account's daily allowance.",
        ],
      },
      {
        title: "Automated access",
        body: [
          "Bots, scrapers and automated clients may not create accounts, sign in, send chat messages, upload files or otherwise drive the web app, except for ordinary search-engine indexing of public pages as allowed by robots.txt. Automated calls to the public API under /api/v1 with your own API key are the supported exception. Rate limits are enforced per account, per key and per IP, and web-app mutation endpoints require same-origin browser headers by design.",
        ],
      },
      {
        title: "Enforcement",
        body: [
          "Automated or abusive access may be rate-limited, blocked or have its accounts terminated under the [terms](/terms) and [acceptable use policy](/acceptable-use). API keys may be revoked and developer access withdrawn for abuse, including attempts to evade the daily token limit by creating multiple accounts.",
        ],
      },
    ],
  },
  subprocessors: {
    title: "Subprocessors",
    intro:
      "The third parties that process data on Xyro AI's behalf, what each one receives, and why. This list reflects the actual stack the product runs on.",
    sections: [
      {
        title: "Google / Firebase",
        body: [
          "Purpose: accounts and data storage. Firebase Authentication holds your email, credential state and verification status; Cloud Firestore holds your profile, settings, chats and session records; Realtime Database holds presence markers and in-progress reply streams. Google also provides the optional Google sign-in identity flow.",
        ],
      },
      {
        title: "OpenRouter and model providers",
        body: [
          "Purpose: generating AI replies. OpenRouter routes each request to a free model provider (for example Meta, Google, DeepSeek, Qwen or Mistral AI, depending on the model chosen and availability). The provider receives the prompt, conversation context, custom instructions if enabled, and relevant attached image or file content, and processes it under its own terms. The specific provider varies per request; the model picker always names the model being used.",
        ],
      },
      {
        title: "Cloudinary",
        body: [
          "Purpose: media storage. Cloudinary stores your uploaded files and avatars, and any images the service creates in future, as authenticated (private) assets, and serves them via short-lived signed access. Files are deleted from Cloudinary when you delete the chat, the file or your account.",
        ],
      },
      {
        title: "Upstash",
        body: [
          "Purpose: rate limiting and session state. Upstash Redis holds hashed rate-limit counters, session-revocation keys, and daily budget counters. Keys are built from hashed identifiers; Upstash does not receive your message content.",
        ],
      },
      {
        title: "Cloudflare",
        body: [
          "Purpose: abuse prevention. Cloudflare Turnstile verifies the human checks at sign-up, sign-in and password reset, processing the challenge token and browser/network signals under Cloudflare's policies.",
        ],
      },
      {
        title: "Vercel",
        body: [
          "Purpose: hosting. Vercel serves the web app and its API routes and processes request metadata (such as IP address and approximate geolocation headers, which the app uses for session location labels and rate limiting) under Vercel's policies.",
        ],
      },
      {
        title: "Have I Been Pwned",
        body: [
          "Purpose: password safety. At sign-up and password change, the first five characters of a SHA-1 hash of the password are sent to the Have I Been Pwned k-anonymity API to check it against known breaches. The password and its full hash are never sent.",
        ],
      },
      {
        title: "Changes",
        body: [
          "If a subprocessor is added or replaced, this page will be updated. Questions: see the [contact page](/contact).",
        ],
      },
    ],
  },
  security: {
    title: "Security at Xyro AI",
    intro:
      "How Xyro AI protects accounts and data, described the way it is actually built — including the residual risks we accept and document rather than hide.",
    sections: [
      {
        title: "Sessions, not just forms",
        body: [
          "The human check gates the server session itself. After sign-in, sign-up, a Google exchange or a silent renewal, the server sets a signed, HttpOnly session cookie (HS256 JWT, 30-day sliding expiry, 90-day absolute cap). Every product API then requires both that cookie and a Firebase ID token whose account matches the session — a stolen browser token or a direct Firebase call alone gets a 401.",
          "Sessions are revocable server-side at any moment: signing out, revoking a session in Settings → Security, a password change, or sign-out-of-all-devices takes effect on the very next API call.",
        ],
      },
      {
        title: "Abuse and rate limiting",
        body: [
          "Cloudflare Turnstile protects sign-up, sign-in and password reset, with tokens verified server-side for the exact action and hostname. Every API route is rate-limited (auth, chat, uploads, settings, export and deletion each have their own caps), every mutation requires same-origin headers, and a daily budget guard queues chat at 85% of the free-tier write budget and pauses it at 95%, so quota exhaustion degrades the service gracefully instead of corrupting it.",
          "Passwords are screened against known breaches via a k-anonymity lookup that never sees the password itself.",
        ],
      },
      {
        title: "Data protection",
        body: [
          "Firestore and Realtime Database rules restrict every record to its owner, and clients cannot write chat data directly — all writes pass through authenticated server routes. Uploaded files are stored as authenticated Cloudinary assets with short-lived access URLs, and their contents are verified server-side by magic bytes and UTF-8 checks, so a mislabelled file is rejected and deleted rather than stored.",
          "The site ships a strict Content Security Policy (nonce-based scripts, no framing, no plugins), HSTS, and restrictive cross-origin headers on every response.",
        ],
      },
      {
        title: "Known residual risk: Firebase's public endpoints",
        body: [
          "Firebase's public authentication endpoints are callable with the public web API key — that is how Firebase is designed, and the key is not a secret. A bot can therefore talk to Firebase directly without passing Turnstile. What it cannot get is a Xyro AI session: every product API refuses requests without one, chat additionally requires a verified email, and our own routes are rate-limited on top of Firebase's built-in throttling.",
          "Deployments further restrict the browser API key by referrer and API scope in Google Cloud Console; the full hardening checklist lives in the project's security notes and setup guide.",
        ],
      },
      {
        title: "Reporting a vulnerability",
        body: [
          "Email the details via the [contact page](/contact) with 'Security' in the subject line. Please don't open public issues for vulnerabilities, and allow reasonable time for a fix before disclosing.",
        ],
      },
    ],
  },
  "privacy-center": {
    title: "Privacy center",
    intro:
      "Every control over your Xyro AI data, in one place. All of these are self-serve and take effect immediately — no emails, no waiting periods, no retention dark patterns.",
    sections: [
      {
        title: "See and download your data",
        body: [
          "Settings → Data controls → Export downloads your chats and account data as JSON and Markdown (one export per day, a free-tier protection). A single chat can be exported from its … menu in the sidebar. Settings → Profile shows the account details we hold: name, email, avatar and verification status.",
        ],
      },
      {
        title: "Delete some of it",
        body: [
          "- A chat: sidebar … menu → Delete — removes its messages, live-stream data and uploaded files",
          "- All chats: Settings → Data controls → Delete all chats (type DELETE to confirm)",
          "- A file: Settings → Data controls → your uploaded files, deleted from Cloudinary storage",
          "- Custom instructions: Settings → Personalization — switch them off or clear the text",
        ],
      },
      {
        title: "Control who is signed in",
        body: [
          "Settings → Security lists every active session with its device, approximate location and last-active time. Revoke any single session, or sign out of all other devices. Revocation ends that session's API access immediately — useful if you lose a device or see a session you don't recognise.",
        ],
      },
      {
        title: "Delete everything",
        body: [
          "Settings → Account → Delete account removes your chats, files, settings, session records and finally your Firebase sign-in identity, and clears your session cookie. It is staged and resumable — if it is interrupted, signing back in lets you finish it — and it is permanent.",
        ],
      },
      {
        title: "The honest exception",
        body: [
          "Deletion inside Xyro AI covers Firebase and Cloudinary. Prompts and file content already sent to OpenRouter and a model provider to generate a reply are governed by that provider's retention policy and cannot be recalled by us — the strongest reason to keep sensitive information out of chats and uploads. See the [privacy notice](/privacy) and [subprocessors](/subprocessors).",
        ],
      },
    ],
  },
  status: {
    title: "Service status",
    intro:
      "Xyro AI is a small free service, and this page is deliberately simple: it explains how availability works and how to check it, rather than showing invented live metrics.",
    sections: [
      {
        title: "How to check right now",
        body: [
          "The app exposes a public health endpoint at /api/health. It reports, as booleans only, whether each integration (Firebase, OpenRouter, Cloudinary, Redis, Turnstile, sessions) is configured — never any values or secrets. If the chat page loads and the health endpoint answers, the service itself is up; if a specific integration shows as unconfigured, that feature is degraded.",
          "Free model availability is separate: the in-app model picker shows the live free catalogue, and a busy model falls back to Auto (Free) automatically.",
        ],
      },
      {
        title: "What 'down' usually means here",
        body: [
          "Xyro AI depends on free tiers with daily quotas. The designed failure modes are graceful: as the service approaches its daily budget, new chat messages queue with an automatic retry, and at the hard ceiling chat pauses until the next day — existing chats, settings, export and account controls keep working. A full outage usually means a hosting (Vercel) or Firebase incident upstream.",
        ],
      },
      {
        title: "Incident communication",
        body: [
          "Meaningful changes and incidents are recorded on the [changelog](/changelog). For anything urgent affecting your account, use the [contact page](/contact). We don't publish uptime percentages — on free tiers they would be decoration, not information.",
        ],
      },
    ],
  },
  developers: {
    title: "Developers",
    intro:
      "Xyro AI has a public, OpenAI-compatible API. Activate it in Settings → Developer, get a key, and call the same free models the app uses — 100,000 tokens a day on the free plan.",
    sections: [
      {
        title: "Getting started",
        body: [
          "Sign in, open [Settings → Developer](/settings/developer) and choose **Activate developer access**. After a few questions about your project you get an API key (shown once — store it safely). The Developer tab is your console: usage dashboard, key management, per-request activity logs and copy-paste quickstarts for cURL, JavaScript and Python.",
          "Base URL: `https://truthai-six.vercel.app/api/v1`. Send the key as `Authorization: Bearer xyro_sk_live_…`. Keep keys on your server — never ship them in browser or mobile code.",
        ],
      },
      {
        title: "Endpoints",
        body: [
          "`POST /api/v1/chat/completions` — OpenAI-shaped: send `model` (optional; defaults to Auto free) and `messages`, get back a `chat.completion` with `choices` and `usage`. Up to 50 messages and `max_tokens` up to 4096 per call; streaming is not supported yet.",
          "`GET /api/v1/models` — the free models your key can use right now, in the OpenAI list shape.",
          "Errors use the OpenAI error shape (`error.message`, `error.type`, `error.code`). The free plan allows 100,000 tokens per day (prompt + completion, resetting at midnight UTC) and 20 requests per minute per key; hitting the daily cap returns `daily_token_limit_exceeded`. The governing terms are the [API terms](/api-terms) and [acceptable use policy](/acceptable-use).",
        ],
      },
      {
        title: "How the product's own API behaves",
        body: [
          "Separately from the public API, the web app talks to first-party endpoints under /api (chat, chats, uploads, settings, account, export, models, usage). Those require the signed session cookie plus a Firebase ID token for the same account, same-origin headers on mutations, and per-route rate limits — they are internal, may change without notice, and are not a contract.",
          "Two endpoints are intentionally public and safe to poll: /api/health, which returns configuration booleans only, and this website's public pages.",
        ],
      },
    ],
  },
  xyroaidetect: {
    title: "A signal, not a verdict.",
    intro:
      "XyroAIDetect is the provenance companion for images created by Xyro AI. It is designed to look for Xyro AI's own watermark signals — it is not a general-purpose 'AI detector', and it is not available as an upload tool on this site.",
    sections: [
      {
        title: "What it is designed to look for",
        body: [
          "Every image created in Xyro AI passes through a server-side watermarking step before delivery: an invisible payload — naming Xyro AI, the generation, and a hash of the creating account — is embedded in the image's least significant pixel bits, and only the watermarked image is stored. XyroAIDetect looks for that signal.",
          "The watermark survives ordinary re-saving as PNG, but it is one signal layer, not armour: the limits below are part of the design, stated plainly.",
        ],
      },
      {
        title: "What a result means — and doesn't",
        body: [
          "A match may indicate that an image contains a signal associated with Xyro AI. It is not proof of who created, owns or edited the image. A non-match does not prove that an image is human-created, or that it was never generated by any AI system — other generators leave no Xyro AI signal at all.",
          "Compression, cropping, resizing, screenshots, brightness or contrast changes and other edits can weaken or remove signals. AI re-generation may remove them entirely.",
        ],
      },
      {
        title: "Privacy and availability",
        body: [
          "Upload-based detection is not enabled on this site; no image upload is accepted here. The planned detector is intended to process uploads in memory, delete them promptly, and apply rate limits; the exact behaviour will be published before launch.",
        ],
      },
      {
        title: "Research and limitations",
        body: [
          "Robustness depends on image format, resolution, transformations and implementation. Detection should be one input among many, never the sole basis for a consequential decision about a person or their work. For the product context, see [image creation](/help-image-creation) in the help center.",
        ],
      },
    ],
  },
});

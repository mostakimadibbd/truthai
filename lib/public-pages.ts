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
          "Xyro AI is a free conversational AI workspace. It provides text conversations using OpenRouter's free model pool, chat history that syncs through Firestore, live-streamed replies through Realtime Database, private file attachments stored in Cloudinary, and image creation from free image sources. See the [changelog](/changelog) for what has shipped.",
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
          "- Chat in three free modes — Fast, Thinking and Lightweight — with automatic fallback when a route is busy",
          "- File uploads and analysis: images, PDF, TXT, Markdown and CSV, up to 10 MB per file and five files per message",
          "- Image creation from the chat composer (10 creations per day), with an invisible watermark on every created picture",
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
        a: "Yes — open a chat, use the + menu's 'Create an image', and describe the picture. Creation uses free image sources only: a free image-capable OpenRouter model when the catalogue has one, and otherwise the free Pollinations generation service. An invisible watermark is applied before the image is stored in Cloudinary, and creation is limited to 10 per day. If both free sources are busy at a given moment, the app says so clearly rather than faking a result.",
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
        a: "Yes — an OpenAI-compatible API under /api/v1. Activate it in Settings → Developer to get a key; the free plan includes 100,000 tokens per day. The other endpoints under /api are the web app's own and require your signed-in session. The developers page has the details, the API reference documents every endpoint and error, and the API terms govern use.",
      },
      {
        q: "Can Xyro AI search the web for recent information?",
        a: "Yes. Web search turns on in two ways: tap the globe button in the composer, or simply ask for something live — the latest news, a price, a score, research — and Xyro AI searches automatically (you'll see “Searching the web…” while it happens). The top results from Bing, Google News or DuckDuckGo are given to the model as context, and the reply cites them — the sources appear as numbered chips under the answer. If you paste a link into a chat, Xyro AI fetches that page directly so the model can read it.",
      },
      {
        q: "Can I listen to replies, or dictate instead of typing?",
        a: "Yes. Every reply has a Read aloud action that speaks it using your browser's built-in text-to-speech voice, and the microphone button in the composer dictates your message using the browser's speech recognition — you'll need to allow microphone permission, and the transcript lands in the composer so you can edit it before sending. Both features run on your browser's own speech tools, so availability depends on the browser.",
      },
      {
        q: "What are the password rules?",
        a: "Passwords must be at least 10 characters and include a lowercase letter, an uppercase letter and a symbol. The sign-up form shows a live checklist that turns green as each rule is met, plus a strength meter, and asks you to type the password twice so a typo can't lock you out. Passwords are also screened against known data breaches before they're accepted.",
      },
      {
        q: "Do I need the human check to sign in with Google?",
        a: "No. Continue with Google never requires the Cloudflare human check — it opens Google's own sign-in popup, and the server verifies your Google identity directly. A brand-new Google account may see a one-time card asking you to accept the terms before the account is created; after that, Google sign-in goes straight into the app.",
      },
      {
        q: "Can I see how many tokens each chat used?",
        a: "Yes. Settings → Usage has a 'Today by chat' list showing every conversation you've used today (counted in UTC), with the model or models it used, its reply count and its token total — so a long conversation's cost is visible instead of disappearing into the daily total.",
      },
      {
        q: "Can I pin a chat so it stays at the top?",
        a: "Yes. Open the … menu on any chat in the sidebar and choose Pin. Pinned chats collect in a Pinned group at the top of the sidebar, above the usual recency groups; unpin from the same menu.",
      },
      {
        q: "Why does creating an API key require a name?",
        a: "So you can tell your keys apart. The name you give a key at creation labels it in the Developer dashboard, the per-request activity log and the access-point list — when something calls your API, you can see which key it was. Names are required; the key itself is shown only once.",
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
        title: "Turn on web search",
        body: [
          "In any chat, tap the globe button in the composer to search with every message — or just ask for current information (latest news, prices, scores, research) and search starts on its own. You'll see “Searching the web…” while it runs. The top results are given to the model as context, and the reply cites them — the sources appear as numbered chips under the answer, and tapping one opens the page. Research-style asks also read the top results in full. Tip: pasting a link into a message makes Xyro AI read that page directly, with or without search on.",
        ],
      },
      {
        title: "Use voice input and read aloud",
        body: [
          "Tap the microphone button in the composer and speak; allow microphone permission when the browser asks. Your words land in the composer as text, so you can fix anything before sending. To hear a reply instead, use the Read aloud action under any answer — it uses your browser's built-in voice, and tapping it again stops playback. Both features depend on the browser's own speech tools, so they may be unavailable in some browsers.",
        ],
      },
      {
        title: "Find tokens per chat",
        body: [
          "Open Settings → Usage and look for 'Today by chat'. Each conversation you've used today (the day is counted in UTC) gets a row with its title, the model or models it used, how many replies it produced, and its token total — handy for spotting which conversation is eating your day.",
        ],
      },
      {
        title: "Create a named API key",
        body: [
          "Open Settings → Developer and activate developer access if you haven't (your email must be verified). In the create-a-key section, give the key a name — it's required, and it's how the key is labelled in your dashboard, activity log and access points — then create it and copy it immediately: the full key is shown only once. The [API reference](/api-reference) documents the endpoints, limits and errors.",
        ],
      },
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
      "Describe a picture and Xyro AI creates it in your chat — using free image sources only, with an invisible watermark applied before the image is stored. This page explains how it works, the limits, and when creation can be temporarily unavailable.",
    sections: [
      {
        title: "How to create an image",
        body: [
          "Open a chat and tap the + button in the composer, then choose 'Create an image'. The composer switches to creation mode: describe the picture you want and send. Your description appears as a message, and the created picture arrives as the reply, attached to the conversation like an uploaded image.",
          "You need a verified email to create images, just like sending messages. Creation is limited to 10 pictures per account per day — a fair-use limit that protects the shared free tiers.",
        ],
      },
      {
        title: "The free-source rule — and when creation is unavailable",
        body: [
          "Creation uses free image sources only — the same free-only rule as chat, and a paid model is never called. The first source is a free image-capable model from OpenRouter, checked against the live catalogue at the moment you ask; free image models come and go, and there are long periods when none is free at all. For those periods, creation falls back to the free Pollinations generation service, which receives only your image description.",
          "If both free sources are busy or fail at a given moment, the app says so plainly — 'Image creation is temporarily unavailable — please try again in a moment' — instead of faking a result. Trying again shortly after is genuinely the fix: the free services queue under load and usually answer within a few tries.",
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
          "- Developer API (only if you activate it): Firestore stores your activation answers (project name, use case, builder type, language, optional website), your API keys as SHA-256 hashes (the full key is shown once and never stored), daily token-usage totals, per-model usage totals, a per-request log with the model used, token counts, the request input and response output, and a request fingerprint (browser/device label and keyed IP hash), plus an access-point record for each distinct calling client with its detected coarse location (city/country) — all visible to you in Settings → Developer",
        ],
      },
      {
        title: "Who else processes your data",
        body: [
          "To generate a reply, your prompt, conversation context, saved memory (when memory is on), custom instructions and any relevant file content are sent to ONE of the free AI providers in Xyro AI's fallback chain. The complete list — there are no others — is: OpenRouter, Groq, Google Gemini, Requesty, SambaNova, NVIDIA and Cloudflare Workers AI. Image creation can additionally use Pollinations and AI Horde. Which provider answered is shown under every reply ('via …'), and the full list of processors is on the [subprocessors](/subprocessors) page.",
          "Each provider's free-tier data terms, as published by the provider and checked in November 2026: OpenRouter does not train on your prompts and does not retain them unless prompt logging is opted into, but the model provider behind OpenRouter applies its own policy and some endpoints retain prompts briefly for abuse prevention. Groq does not retain prompts by default (up to 30 days for reliability and abuse logs) and its contract bars training on your inputs and outputs without your permission. Google Gemini's free tier is different: Google uses unpaid-tier content to improve its products and machine-learning technologies, and human reviewers may read and annotate it — Google itself advises not to submit sensitive or personal information to the free tier (this does not apply in the EEA, Switzerland or the UK, where paid-tier terms apply). Requesty logs prompts and outputs by default, encrypted in the EU for up to 30 days (logging can be turned off per API key), and its free-plan terms allow it to use content for its own training. SambaNova's data processing agreement says prompts are processed transiently, kept no more than 30 days solely for security, fraud and abuse monitoring, and never used to train on customer personal data. NVIDIA's free API is a trial: its terms allow NVIDIA to collect your prompts and generated content, de-identified, to improve its products and services including AI models. Cloudflare Workers AI does not retain inputs or outputs after a standard request and does not use customer content to train models.",
          "The two community image services deserve a special warning: Pollinations processes prompts transiently but may cache generated responses for up to about 30 days and routes some models through independent community providers under their own policies, and AI Horde is a volunteer network — your image prompt is processed on a volunteer's own computer, where the volunteer could in principle see or log it. Never put anything sensitive in an image prompt.",
          "If you would rather none of these providers sees your data, turn on 'Only use OpenRouter' in Settings → Data controls: your prompts, files and memory then go only to OpenRouter, the other providers and the community image services are never used for your account, and image creation is limited to OpenRouter's own image models. Whichever setting you choose: providers process data under their own terms and Xyro AI can't delete data from a provider's systems, so don't send sensitive information to any AI service, including this one.",
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
        title: "November 15, 2026 · Developer platform",
        body: [
          "Settings gained a Developer tab: activate access with a short project questionnaire, create API keys (each with a name you choose, so keys are easy to tell apart), and call an OpenAI-compatible API at /api/v1 — the same free models as the app, with 100,000 tokens a day on the free plan. The tab is a real console: usage and cost by model with charts, per-request activity with stored input/output logs, the access points your keys call from, and copy-paste quickstarts. The [developers page](/developers) and [API terms](/api-terms) document it, and the logging is disclosed there and in the [privacy center](/privacy-center).",
        ],
      },
      {
        title: "November 15, 2026 · Usage analytics",
        body: [
          "Every chat turn, API call and image creation is now metered — tokens, model and estimated cost — into a per-request ledger and per-minute and daily rollups. Your own totals power the new token charts in Settings → Usage; the platform-wide view is restricted to Xyro AI administrators and keeps counting even if a chat is later deleted, as disclosed in the [privacy center](/privacy-center). An admin console at /admin shows the live picture.",
        ],
      },
      {
        title: "November 15, 2026 · Chat experience",
        body: [
          "Signing in now lands on a fresh new chat instead of reopening your last conversation. Chats can be pinned to a Pinned group at the top of the sidebar; replies got a calmer reading design (better typography, tables and code blocks, a streaming cursor); the greeting carries your name in a gradient, suggestions are cards, and a scroll-to-bottom button appears in long conversations.",
        ],
      },
      {
        title: "November 15, 2026 · Google sign-in, simplified",
        body: [
          "Continue with Google no longer waits for the human check — that check now guards only email/password sign-in and sign-up, and the server confirms the provider from the verified token. The Google flow is popup-first (the redirect return leg silently failed in some privacy-focused browsers), and a brand-new Google account gets a one-time terms consent step instead of a dead-end error.",
        ],
      },
      {
        title: "November 15, 2026 · A calmer blue design",
        body: [
          "The full palette moved from pink and purple to blue and azure across both themes — every accent, gradient, badge and shadow — and the phone layout was fixed where the redesign had clipped the chat empty state and crowded the model picker. New public pages arrived with it: [models](/models), [use cases](/use-cases) with pages for [students](/for-students), [writers](/for-writers), [creators](/for-creators) and [business](/for-business), plus a [roadmap](/roadmap).",
        ],
      },
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
        title: "8. Your content",
        body: [
          "You keep ownership of the messages, files and other content you submit. You grant us and our providers the licence needed to operate the service for you: to store, transmit, process and display your content to provide the features you use, and nothing more — we do not claim ownership of your content and do not use it to train models, except where a model provider's own free-tier terms say otherwise (those are disclosed in the privacy notice and on the subprocessors page, and the 'Only use OpenRouter' setting exists to limit them).",
          "Output the models generate for you is yours to use as between you and us, subject to the relevant provider's terms and to other people's rights: similar output may be generated for others, and output can be inaccurate, so check anything important before relying on it. You are responsible for your inputs: do not submit content you do not have the right to use, content that is unlawful, or other people's personal data without a proper basis.",
        ],
      },
      {
        title: "9. Acceptable use",
        body: [
          "The acceptable use policy is part of these terms. In short: no illegal activity, no attempts to make the service produce content that facilitates serious harm, no abuse of the free tiers (including creating accounts or keys to evade limits), no interference with the service or other users, and no using generated output to deceive people about its origin where that would mislead them. Violations can lead to warnings, feature limits, suspension or closure, with human review of automated safety flags before significant action.",
        ],
      },
      {
        title: "10. Availability and changes to the service",
        body: [
          "Xyro AI is a free service built on free tiers of its providers. It is provided without an uptime commitment: features may change, be limited (for example when a provider's free quota is exhausted) or be discontinued, and scheduled or emergency maintenance may interrupt access. We will try to give reasonable notice of material changes on this site or in the product, but the service may evolve without notice where a provider's terms or capacity force a change.",
        ],
      },
      {
        title: "11. Suspension and termination",
        body: [
          "You may stop using Xyro AI at any time and may close your account from Settings → Account, which deletes the account and its content from the live service subject to the privacy notice's retention section. We may suspend or close an account that violates these terms or the acceptable use policy, that creates a security or legal risk, or that appears abandoned under a prolonged-inactivity policy we publish in advance. Where the violation is not serious or urgent, we will warn first where practical. Termination ends the licence to use the service; sections that by their nature should survive (content ownership, liability, governing law) survive termination.",
        ],
      },
      {
        title: "12. Warranties and liability",
        body: [
          "The service is provided 'as is' and 'as available', without warranties of any kind to the maximum extent the law permits, including fitness for a particular purpose and non-infringement. AI output is generated by third-party models and may be wrong, incomplete or offensive; it is not professional advice. To the maximum extent permitted by law, our total liability arising from the service is limited to the greater of the amount you paid for the service in the twelve months before the claim (zero for the free service) and the minimum amount the applicable law requires. Nothing in these terms limits liability that cannot be limited by law, including for death or personal injury caused by negligence, or your statutory consumer rights.",
          "You agree to indemnify us against claims arising from your content or your misuse of the service, to the extent permitted by law. If a provision of these terms is found unenforceable, the remaining provisions continue in full effect, and the unenforceable provision is modified only as much as needed to make it enforceable.",
        ],
      },
      {
        title: "13. General",
        body: [
          "These terms are the whole agreement between you and us about Xyro AI and replace any earlier understandings about the service. We may assign our rights under these terms as part of a merger, acquisition or asset transfer, with notice on this site; you may not assign yours without our consent. A failure to enforce a provision is not a waiver of it. Headings are for readability only. Where a provision requires notice, notice to you may be given in the product, on this site, or to the account email; notice to us goes through the contact page. The service is intended for users aged 18 and over, or the age of majority where you live if higher.",
        ],
      },
      {
        title: "14. Contact",
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
      {
        title: "How long we keep things",
        body: [
          "Chats and files: kept until you delete them or close your account. Deleting a chat removes its messages from your account; backups and replicas can take a short time to fully expire, and a minimal metadata snapshot of a deleted account is kept in a restricted trash archive so abuse and accidental-deletion cases can be reviewed.",
          "Usage and analytics: per-request metering records and daily aggregates are kept so the usage dashboards and plan limits can be computed; aggregates without message content may be kept longer than individual events. Security records — sign-in events, device records and safety flags — are kept while the account is active and for a limited period afterwards, because they exist to investigate abuse; a safety flag records the flagged prompt, the category and the review outcome, never anything beyond the conversation it came from.",
          "Developer API records: per-request API activity (timestamps, model, token counts, status) is kept for the life of the developer profile so the console can show it; API keys themselves are stored only as hashes and disappear when revoked. Backups: encrypted backups of the database are kept on a rolling basis and age out automatically; data deleted from the live service can persist in a backup until that backup ages out, and is not restored except for disaster recovery, after which deletions are re-applied.",
        ],
      },
      {
        title: "Your rights",
        body: [
          "Access and portability: Settings → Data controls exports your chats and account data in a machine-readable form at any time, without asking us. Correction: profile details, memories and preferences are editable in Settings, and anything you cannot edit yourself can be corrected through the contact page. Deletion: you can delete individual chats, files and memories, or close the whole account from Settings → Account; closure removes the account and its content from the live service, subject to the limited retention described above.",
          "Objection and restriction: you can object to processing that is based on legitimate interests — including safety screening — through the contact page, and we will stop unless a compelling reason (such as an ongoing abuse investigation) requires otherwise. You can also restrict processing while a request is reviewed. We respond to rights requests within 30 days, verify identity against the account before acting on them, and never sell personal data or share it for cross-context behavioural advertising. Using your rights never changes the service you receive, except where the law requires otherwise.",
          "Complaints: if you believe your data has been mishandled, contact us first so we can put it right; you also have the right to complain to your local data-protection authority. Where European or UK data-protection law applies, the rights above include the full set provided by that law, and the same self-serve controls are offered to every account regardless of location.",
        ],
      },
      {
        title: "International transfers and automated processing",
        body: [
          "Xyro AI is operated on infrastructure and model providers located mainly in the United States and the European Union, so your data may be processed in a country other than your own. Where the law requires a transfer safeguard, we rely on the providers' standard contractual terms and data-processing agreements, listed on the subprocessors page. You can reduce what leaves our own systems at any time with the 'Only use OpenRouter' switch described above.",
          "No automated decision with legal or similarly significant effect is made about you. Model routing (choosing which free model answers) is not profiling for marketing, and we do not build advertising profiles. Safety screening is automated only at the detection step: a pattern match or a model's refusal can create a flag, but a human administrator reviews flags and decides any action, and flags are invisible to the flagged account unless action is taken.",
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
      {
        title: "Content that is never allowed",
        body: [
          "Sexual content involving minors, in any form and by any route, including fictional, drawn or generated material and any attempt to obtain it — this carries zero tolerance: accounts are closed and, where the law requires or permits, reports are made to the relevant authorities. Content that facilitates serious physical harm: instructions or facilitation for weapons, explosives, or violent wrongdoing; instructions for manufacturing illicit drugs; and content that praises or recruits for violent extremist organisations.",
          "Cybercrime and fraud: malware, phishing, credential theft, hacking instructions aimed at systems you do not own or have permission to test, fraud and scam content, counterfeit documents, and impersonation intended to deceive. Privacy violations: disclosing other people's personal data, non-consensual intimate imagery, stalking or harassment content, and attempts to extract personal data about identifiable people. Intellectual-property abuse: reproducing large amounts of copyrighted text or uploading content you have no right to use. Spam and manipulation: bulk unsolicited content, fake engagement, deceptive impersonation of the service or its staff, and presenting generated output as human work where that deception matters (for example in reviews, testimonials or academic submissions).",
        ],
      },
      {
        title: "Misuse of the service itself",
        body: [
          "Do not evade the product's limits: creating multiple accounts or API keys to multiply free allowances, sharing keys publicly, reselling access, or scripting sign-ups. Do not probe, scan or attack the service or its providers beyond ordinary use, attempt to bypass bot protection, rate limits or safety systems, or try to extract other users' data, prompts or system instructions. Do not use the API or the app to build a competing dataset by bulk-harvesting outputs, and do not use generated output to train a model in a way that violates the underlying providers' terms. Automated access is allowed only through the documented public API with a valid key.",
        ],
      },
      {
        title: "How enforcement works",
        body: [
          "Detection is partly automated: a deterministic classifier screens prompts for high-confidence harmful requests, and a model's own safety refusal can also raise a flag. A flag is invisible to the account — it changes nothing about the person's experience — and exists only so a human administrator can review the flagged conversation in context. Admins can read the chats attached to a flag, and every such view is written to the audit log. Decisions are made by people, not by the classifier: outcomes range from dismissing the flag, to a warning, to limiting features, suspending the account, or closing it for serious or repeat violations.",
          "If your account is limited or closed and you believe it was a mistake, contact us with the account email and what happened; a person will re-review the flags and the decision. Some content is removed or refused without any account action at all — a refusal by a model is the normal, expected behaviour for disallowed requests and is not a punishment. We may also act on reports from other users and from providers, and we cooperate with lawful requests from authorities.",
        ],
      },
      {
        title: "High-risk and regulated uses",
        body: [
          "The models can be wrong, including confidently wrong. Do not rely on output as medical, legal, financial or other professional advice, and do not use the service for decisions that significantly affect other people — employment, housing, credit, insurance, education admissions — without independent human review and a lawful basis. Emergency situations are out of scope entirely: if someone is in danger, contact local emergency services, not an AI chat. Self-harm content is handled with care rather than punishment: the service responds supportively and encourages professional help, and such conversations are not treated as violations by the person seeking help.",
          "Political and civic content must not be used to deceive: no fabricated quotes, images or recordings of real people presented as genuine, no impersonation of officials or campaigns, and no coordinated inauthentic behaviour. Research, journalism, education and discussion about any of the topics in this policy are legitimate uses — context matters, and reviewing admins are instructed to distinguish a harmful request from a conversation about harm, which is one reason flags are reviewed by people before any significant action.",
        ],
      },
      {
        title: "Examples",
        body: [
          "Allowed: discussing how phishing works in order to defend against it; asking how to protect an account, a home network or a business from hackers; writing fiction in which crimes occur; studying the history of weapons, wars or drugs; asking for harm-reduction information; debating drug policy, gun policy or any other contested question; testing the security of systems you own or are authorised to test, described in those terms. The classifier and reviewing admins are both instructed that these are legitimate, and a flag raised by an ambiguous phrasing is dismissed on review.",
          "Not allowed: step-by-step instructions for making a weapon, drug or fraudulent document, whoever they are for; help drafting a phishing message or a scam script; assistance planning a specific act of violence or evading detection afterwards; sexual content involving anyone under 18 in any framing; generating bulk reviews, comments or messages intended to look like genuine public opinion; and re-asking a refused request in slightly different words to shop for a model that will comply — the safety refusal is the answer, and repeated attempts are themselves a policy violation that flags will show.",
        ],
      },
      {
        title: "Generated media",
        body: [
          "Images created with Xyro AI carry an invisible provenance watermark and are stored with the generating account. Do not remove or obscure provenance signals, and do not use generated images to impersonate real people, fabricate evidence, or create non-consensual imagery of anyone — generated or otherwise. Synthetic media that could deceive (a fake screenshot of a real conversation, a fabricated document image) is treated as fraud content under this policy, whether it was made here or elsewhere and merely uploaded.",
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
      {
        title: "The storage we actually use",
        body: [
          "Session cookie: when you sign in, the service sets a single strictly-necessary session cookie (named __Host-xyro_session, with a legacy fallback name) that carries a signed token identifying your session. It is HttpOnly, Secure and SameSite=Lax, so page scripts cannot read it and it is not sent on cross-site requests. The session slides with activity up to 30 days and ends absolutely at 90 days; signing out revokes the session on the server as well as clearing the cookie. Without this cookie the app cannot know who you are, so it cannot be declined while signed in — signing out is the opt-out.",
          "Sign-in and bot protection: Google sign-in and Firebase Authentication store tokens in your browser's local storage and IndexedDB (not cookies) so you stay signed in across tabs; those stores are cleared on sign-out. Cloudflare Turnstile, which checks that sign-ups and sign-ins come from a person rather than a bot, sets its own cookies under Cloudflare's control when the check runs; the widget appears under the sign-in and sign-up forms and on the bot-check page, and Google accounts signing in are exempt from the check.",
          "Preferences: choices such as theme, model mode and privacy switches are stored with your account and, for the pre-sign-in screens, in your browser's local storage. The site does not use fingerprinting to replace cookies, and a device hash computed at sign-in for security (recognising your own devices in Settings → Security) is stored server-side with your account, not as a tracking cookie.",
        ],
      },
      {
        title: "What we do not use",
        body: [
          "No advertising cookies. No cross-site trackers. No analytics cookies — usage is metered on our own servers (request counts and token totals, disclosed in the privacy notice) rather than by dropping third-party analytics beacons on your device. No social-media pixels, no session-replay tools, and no selling or sharing of cookie data, because there is no cookie data beyond the session and preference storage described here.",
          "If that ever changes — for example, if an analytics or advertising tool were introduced — this page and the privacy notice would be updated first, the tool would be listed here with its purpose and lifetime, and consent would be requested where the law requires it before the tool is loaded.",
        ],
      },
      {
        title: "Managing cookies and similar storage",
        body: [
          "Every modern browser lets you view, block and delete cookies and site data per site. Blocking the session cookie means the app will treat you as signed out; deleting site data for this origin removes the locally stored sign-in tokens and preferences as well. Clearing cookies alone does not revoke a server session from other devices — use Settings → Security to review signed-in devices and sign out everywhere, and Settings → Account to sign out of this device completely.",
          "We do not respond differently to Do Not Track signals, because the site does not track across sites in the first place. Where a browser sends a Global Privacy Control signal, we treat it consistently with this notice: there is no sale or sharing of personal data for it to opt out of. Questions about any of this go through the contact page.",
        ],
      },
      {
        title: "Itemised list",
        body: [
          "- __Host-xyro_session — the session cookie described above. Purpose: keeping you signed in securely. Lifetime: sliding 30 days, absolute cap 90 days, revoked server-side on sign-out. Set by: this site. Type: strictly necessary.",
          "- xyro_session — legacy fallback name for the same session cookie on origins where the __Host- prefix cannot be used. Same purpose, same lifetime, same protections.",
          "- Cloudflare Turnstile cookies (names vary, set under Cloudflare's control) — purpose: distinguishing people from bots during sign-up, sign-in and the bot-check page. Lifetime: set by Cloudflare, typically short. Type: strictly necessary security.",
          "- Firebase Authentication local storage and IndexedDB entries — purpose: keeping your sign-in recognised across tabs and visits. Cleared on sign-out. Type: strictly necessary. These are browser storage, not cookies, but they serve the same function so they are listed here.",
          "- Local preference storage — theme and interface choices for visitors who are not signed in. Purpose: remembering how you left the site. Lifetime: until you clear site data. Type: functional.",
          "Anything not on this list is not set by us. If your browser shows other cookies for this origin, they will belong to an embedded provider named above (Cloudflare or Google, during sign-in) and are governed by that provider's own policy.",
        ],
      },
      {
        title: "Changes to this notice",
        body: [
          "This page is versioned by its 'last updated' date. If the storage the site uses changes materially — a new cookie, a new embedded provider, a new purpose — the itemised list above is updated before or as the change ships, and significant changes are also noted in the changelog. Older versions are not kept on the site; ask through the contact page if you need to know what this notice said at a particular time, for example for a compliance review.",
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
      "These terms govern the public developer API under /api/v1, the product's own endpoints, and any automated access to the service.",
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
        title: "Logging and metering",
        body: [
          "Every API call is logged for metering, security and abuse prevention: the model used, token counts, the estimated cost, the request input and the response output, and a request fingerprint (client/device label, browser signals and a keyed hash of the IP address — never the raw IP). Each distinct calling client is also recorded as an access point with its detected coarse location (city/country). These records are stored on the account and visible to the account holder in [Settings → Developer](/settings/developer); the [privacy center](/privacy-center) describes the data in full. Do not send personal data of third parties through the API unless you have the right to do so.",
        ],
      },
      {
        title: "Enforcement",
        body: [
          "Automated or abusive access may be rate-limited, blocked or have its accounts terminated under the [terms](/terms) and [acceptable use policy](/acceptable-use). API keys may be revoked and developer access withdrawn for abuse, including attempts to evade the daily token limit by creating multiple accounts.",
        ],
      },
      {
        title: "Keys and credential security",
        body: [
          "A key is a credential for your account: anyone holding it can spend your daily token allowance and act through the API as you. Keys are shown once at creation and stored by us only as SHA-256 hashes, so we cannot display a key again or recover a lost one — revoke it and create a replacement. Give each key a name that says where it is used, keep keys in server-side secret storage, never commit them to source control or ship them in browser or mobile apps, and rotate them if a leak is suspected. You are responsible for activity performed with your keys, including by people you share them with. Tell us through the contact page if you believe a key has been compromised; revocation in Settings → Developer takes effect immediately.",
          "Developer access requires a verified account email and the activation questionnaire in Settings → Developer. We may refuse or withdraw activation where the stated use would breach these terms or the acceptable use policy. One person may not hold multiple accounts to multiply API allowances; allowances attach to the person, not the account.",
        ],
      },
      {
        title: "Metering, logs and the console",
        body: [
          "Every API call is metered: timestamps, key, requested model or mode, the provider and model that answered, token counts, latency class and success or error status are recorded and shown to you in Settings → Developer, including per-request activity with stored input and output for your own debugging. That logging is part of the service — it is how daily limits are enforced and how abuse is investigated — and it is disclosed in the privacy notice and the privacy center. Logs are retained for the life of the developer profile; deleting the account deletes the logs with it. Do not send personal data of third parties through the API unless you have the right to do so; as between you and us, you are the controller of content you send and we process it on your instructions to return a completion.",
        ],
      },
      {
        title: "Output, availability and changes",
        body: [
          "Completions are generated by third-party free models and may be inaccurate, incomplete or similar to output generated for others; you are responsible for reviewing output before relying on it and for complying with the underlying providers' terms, which the subprocessors page identifies. The API is a free service without an availability commitment: upstream free quotas are shared and finite, so calls can be throttled or fail when providers are saturated, and error responses distinguish that case (model_busy, model_unavailable) from problems with your request.",
          "We may change the API — including models offered, limits and these terms — and will mark material changes on this page with a new date; breaking changes will be announced on the developers page where practical. Continued use after a change takes effect is acceptance of it. We may suspend keys or access that breach these terms, threaten the service's stability, or evade limits, and may terminate the API programme itself with reasonable notice where practical. On termination, keys stop working and stored logs are handled as described above.",
        ],
      },
      {
        title: "Limits in detail and support",
        body: [
          "The free plan's limits are enforced per account: 100,000 tokens per day across all keys combined (prompt and completion tokens both count, measured by the answering provider's own accounting or, where a provider does not report usage, a character-based estimate that the console flags as estimated), and 20 requests per minute per key. Requests that fail validation do not consume tokens; requests rejected by an upstream model after acceptance may still record the attempt in the activity log with an error status. The daily window resets at midnight UTC; the per-minute window is a rolling rate limit, and the error response for both cases includes the code that tells you which limit you hit, so clients can back off appropriately instead of guessing.",
          "Support for the API is through the contact page and the help center; the status page reports known incidents affecting the app and, where they affect it, the API. There is no paid tier and no support SLA on the free plan — the developers page and this reference are the canonical documentation, and where sample code and behaviour disagree, the behaviour of the live API and the error codes in this reference govern.",
        ],
      },
      {
        title: "Privacy for API traffic",
        body: [
          "API prompts and completions pass through the same provider chain as the app and are governed by the same disclosures: the privacy notice lists every provider that can receive a prompt and each provider's free-tier logging and training terms, and the account-level 'Only use OpenRouter' switch also governs API traffic for keys on that account. Safety screening applies to API traffic as it does to app traffic, and the acceptable use policy binds API use in full. If you build a product on this API, you are responsible for your own users' notices and consents, and for telling them their prompts are processed by an AI service — do not present the API as your own model.",
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
        title: "OpenRouter",
        body: [
          "Purpose: generating AI replies — the primary route. OpenRouter routes each request to a free model hosted by an upstream provider (for example Meta, Google, DeepSeek or Qwen, depending on the model and availability). The request carries your prompt, conversation context, saved memory and custom instructions when enabled, and relevant attached image or file content. OpenRouter states it does not train on your prompts and does not retain them unless prompt logging is opted into; the upstream model provider applies its own policy, and some endpoints retain prompts briefly for abuse prevention. Which provider answered is shown under every reply.",
        ],
      },
      {
        title: "Groq",
        body: [
          "Purpose: fallback AI replies when OpenRouter cannot answer (and the preferred route for Fast mode). Groq receives the same prompt payload as OpenRouter would. Per Groq's published data policy (checked November 2026): prompts are not retained by default, may be kept up to 30 days in reliability and abuse logs, and Groq's services agreement bars training on customer inputs and outputs without explicit permission.",
        ],
      },
      {
        title: "Google Gemini",
        body: [
          "Purpose: fallback AI replies and image analysis, and one of the image-generation sources. Per Google's Gemini API terms for the unpaid tier (checked November 2026): content submitted is used to provide, improve and develop Google products and machine-learning technologies, and human reviewers may read, annotate and process API input and output; Google advises not to submit sensitive, confidential or personal information to the unpaid services. In the EEA, Switzerland and the UK, the paid-tier terms (no improvement use) apply instead.",
        ],
      },
      {
        title: "Requesty",
        body: [
          "Purpose: fallback AI replies. Requesty is a routing gateway: the prompt passes through Requesty to the model provider serving it. Per Requesty's published security documentation (checked November 2026): prompt and output logging is on by default on self-serve plans, retained encrypted in the EU for up to 30 days, can be disabled per API key, and its free-plan privacy terms allow Requesty to use content for its own training.",
        ],
      },
      {
        title: "SambaNova",
        body: [
          "Purpose: fallback AI replies. Per SambaNova's data processing agreement (checked November 2026): prompts and completions are processed transiently and retained no more than 30 days solely for security, fraud and abuse monitoring, and SambaNova will not use customer personal data to train or fine-tune models.",
        ],
      },
      {
        title: "NVIDIA",
        body: [
          "Purpose: fallback AI replies. NVIDIA's hosted API catalog is offered under its API Trial Terms (checked November 2026): the free tier is licensed for trial and evaluation use, and NVIDIA may collect user content and generated content, without identifying specific users, to improve NVIDIA products and services, including AI models.",
        ],
      },
      {
        title: "Pollinations",
        body: [
          "Purpose: image generation (the first source tried). Pollinations receives only the image description you wrote — no account details, no chat history — and returns the generated picture, which is then watermarked and stored like every created image. Per Pollinations' privacy policy (checked November 2026): prompts and outputs are processed transiently, generated responses may be cached for up to about 30 days, Pollinations does not train on your prompts without opt-in, and some models run on independent community providers whose own policies apply.",
        ],
      },
      {
        title: "AI Horde",
        body: [
          "Purpose: fallback image generation. AI Horde is a volunteer-run network: your image prompt is processed on a volunteer's own computer, and that volunteer could in principle see or log the prompt. It receives only the image description — no account details, no chat history — but you should treat image prompts sent to community services as effectively public and never include anything sensitive in them.",
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
          "Purpose: abuse prevention and fallback AI. Cloudflare Turnstile verifies the human checks at sign-up, sign-in and password reset, processing the challenge token and browser/network signals under Cloudflare's policies. Cloudflare Workers AI also serves fallback chat replies (the preferred route for Lightweight mode) and one of the image-generation models; per Cloudflare's Workers AI data-usage commitments (checked November 2026), inputs and outputs are not retained after a standard request and customer content is not used to train models.",
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
        title: "Web search providers (Bing, Google News, DuckDuckGo)",
        body: [
          "Purpose: live web results in chat. When web search runs — because you turned on the search toggle in the composer, or because your message asks for current information (news, prices, scores, research) — the text of your message is sent as a search query to one of several public search sources (Microsoft Bing, Google News, DuckDuckGo), and the top results are used as context for the reply; the sources are shown under the answer. Timeless questions are never sent. Links you paste into a chat are fetched directly by Xyro AI's server, not through a search provider.",
        ],
      },
      {
        title: "Changes",
        body: [
          "If a subprocessor is added or replaced, this page will be updated. Questions: see the [contact page](/contact).",
        ],
      },
      {
        title: "How subprocessors are chosen and changed",
        body: [
          "A subprocessor is added only when a feature needs it, and only after its data practices are reviewed against three questions: does it receive the minimum data the feature requires, does it commit to not using customer content beyond providing the service (or, where a free tier cannot commit to that, is the exception disclosed in the privacy notice and in the per-provider notes above), and does it offer deletion and security controls proportionate to what it receives. Free tiers constrain these choices — that trade-off is disclosed rather than hidden, and the 'Only use OpenRouter' setting in Settings → Data controls exists so any user can narrow the set of processors that can receive their prompts to a single router.",
          "This list is the live record: when a subprocessor is added, replaced or removed, this page is updated with a new date before or as the change takes effect, and material changes are also noted in the changelog. Data locations follow each provider's own infrastructure — mainly the United States and the European Union for the providers above; the per-provider notes link to each provider's own documentation, which governs where that provider processes data. Questions about any subprocessor go through the contact page.",
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
        title: "Web search",
        body: [
          "When web search runs — the toggle in the composer is on, or your message asks for current information such as news, prices, scores or research — the text of the message is sent as a search query to a public search source (Microsoft Bing, Google News or DuckDuckGo), and the top results are passed to the model as context; the sources are shown under the reply. Timeless questions are not sent anywhere. Each search is logged in Xyro AI's database (the query, what triggered it, which source answered, how many results came back, and the sources shown) so the feature's reliability can be monitored and abuse investigated; the log is not readable from any client account. Links you paste into a chat are fetched directly by Xyro AI's server so the model can read the page. The search providers are listed on the [subprocessors](/subprocessors) page.",
        ],
      },
      {
        title: "The honest exception",
        body: [
          "Deletion inside Xyro AI covers Firebase and Cloudinary. Prompts and file content already sent to OpenRouter and a model provider to generate a reply are governed by that provider's retention policy and cannot be recalled by us — the strongest reason to keep sensitive information out of chats and uploads. See the [privacy notice](/privacy) and [subprocessors](/subprocessors).",
          "One more record outlives a deleted chat: the platform's operational metering. Every chat turn, API call and image creation is counted — tokens used, model, estimated cost — in aggregate analytics visible only to Xyro AI administrators. These records contain no message content; they exist so usage and cost can be accounted for honestly.",
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
          "The full [API documentation](/developers/docs) is the complete reference: authentication, both endpoints, limits, every error code, and copy-paste examples in cURL, JavaScript and Python.",
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
  "api-reference": {
    title: "API reference",
    intro:
      "The complete reference for Xyro AI's public API: an OpenAI-compatible chat completions endpoint and a models list, authenticated with a key from Settings → Developer. The [developers page](/developers) is the quickstart; the [API terms](/api-terms) govern use.",
    sections: [
      {
        title: "Authentication",
        body: [
          "Base URL: `https://truthai-six.vercel.app/api/v1`. Every request sends your key as a bearer token: `Authorization: Bearer xyro_sk_live_…`.",
          "Create keys in [Settings → Developer](/settings/developer): developer access must be activated first (a short project questionnaire), your email must be verified, and you can hold up to 5 active keys. Each key requires a name — it labels the key in your dashboard, activity log and access points, so keys are easy to tell apart. A key is shown once, at creation; only its SHA-256 hash is stored server-side, so a lost key can't be recovered — revoke it and create a new one. Keep keys on your server, never in browser or mobile code.",
        ],
      },
      {
        title: "List models — GET /api/v1/models",
        body: [
          "Returns the free models your key can use right now, in the OpenAI list shape: an object with `object: \"list\"` and a `data` array of model objects (`id`, `object: \"model\"`, `owned_by`).",
          "Each model also carries pricing fields taken from the OpenRouter catalogue — the price per million prompt and completion tokens. The models the API serves are free; the pricing fields describe the catalogue rate, and the free plan's daily token allowance (see Limits) is what actually meters your use.",
        ],
      },
      {
        title: "Create a chat completion — POST /api/v1/chat/completions",
        body: [
          "Sends a conversation to a free model and returns the reply in the OpenAI `chat.completion` shape. `Content-Type` must be `application/json` — anything else is rejected with 415.",
          "- `model` (optional): a model id from GET /api/v1/models. Omit it to use Auto free routing (`openrouter/free`), which lets OpenRouter pick an available free model",
          "- `messages` (required): an array of up to 50 messages, each `{ \"role\": \"system\" | \"user\" | \"assistant\", \"content\": \"…\" }` with a non-empty string content",
          "- `max_tokens` (optional): an integer, up to 4096",
          "- `temperature` (optional): a number from 0 to 2",
          "- `stream`: streaming is not supported — send `false` or omit it; `stream: true` returns 400",
          "Unknown top-level parameters are rejected by name with a 400 `unknown_parameter` error, so a typo fails loudly instead of being silently ignored.",
        ],
      },
      {
        title: "Example",
        body: [
          "`curl https://truthai-six.vercel.app/api/v1/chat/completions -H \"Authorization: Bearer xyro_sk_live_…\" -H \"Content-Type: application/json\" -d '{\"messages\": [{\"role\": \"user\", \"content\": \"Say hello in one short sentence.\"}], \"max_tokens\": 256}'`",
          "The response is a standard chat completion object:",
          "`{\"id\": \"chatcmpl-…\", \"object\": \"chat.completion\", \"created\": 1763000000, \"model\": \"openrouter/free\", \"choices\": [{\"index\": 0, \"message\": {\"role\": \"assistant\", \"content\": \"Hello — good to meet you.\"}, \"finish_reason\": \"stop\"}], \"usage\": {\"prompt_tokens\": 12, \"completion_tokens\": 7, \"total_tokens\": 19}}`",
        ],
      },
      {
        title: "Errors",
        body: [
          "Errors use the OpenAI shape: `{ \"error\": { \"message\": \"…\", \"type\": \"…\", \"code\": \"…\" } }`. The codes you can meet:",
          "- 401 `invalid_api_key` — the key is missing, malformed, revoked, or belongs to a deactivated account",
          "- 400 `invalid_request` — the body fails validation (for example an empty message content, more than 50 messages, `max_tokens` over 4096, or `stream: true`)",
          "- 400 `unknown_parameter` — an unsupported top-level field was sent; the message names it",
          "- 415 — the `Content-Type` was not `application/json`",
          "- 429 `rate_limit_exceeded` — more than 20 requests in a minute on one key",
          "- 429 `daily_token_limit_exceeded` — the free plan's 100,000 tokens for the day (UTC) are used up",
          "- 502 — the upstream model provider failed or returned something unusable; retrying, or letting Auto routing pick another free model, usually resolves it",
        ],
      },
      {
        title: "Limits",
        body: [
          "- 100,000 tokens per day per account (prompt + completion), resetting at midnight UTC",
          "- 20 requests per minute per key",
          "- Up to 5 active keys per account",
          "Failed authentication attempts are throttled per IP, so repeated bad keys from one address start returning 429s. Usage, per-model totals and a per-request activity log (including the stored request input and response output) are visible in Settings → Developer — that logging is part of the deal and is disclosed in the [API terms](/api-terms).",
        ],
      },
    ],
  },
  models: {
    title: "The models behind Xyro AI",
    intro:
      "Xyro AI runs entirely on OpenRouter's free model pool. This page explains how model choice works, what Auto (Free) does, and why the catalogue you see in the app is the only list we treat as current.",
    sections: [
      {
        title: "Free models only — by rule, not by trial",
        body: [
          "Every model Xyro AI can call is one OpenRouter lists as free. There is no paid tier hiding behind the picker: when a model costs money, Xyro AI simply doesn't offer it, and the server only ever requests models whose price is zero.",
          "That pool is genuinely capable — large open models from makers such as Meta, Google, DeepSeek, Qwen and Mistral AI regularly appear in it, covering general chat, reasoning, code, and image understanding. A few examples are listed on the [home page](/), but treat them as examples only.",
        ],
      },
      {
        title: "Auto (Free): the zero-decision default",
        body: [
          "With Auto (Free), OpenRouter routes each prompt to an available free model. It is the default in chat and the recommended starting point: no decisions, and if one model is busy, routing can land on another.",
          "Prefer a specific model? Pick it in the chat's model picker or set a default in Settings → General. If your pick is busy or fails, chat falls back through other free models — and ultimately to Auto (Free) — instead of erroring out, and tells you when it does.",
        ],
      },
      {
        title: "Vision and image creation",
        body: [
          "Some free models can see: attach an image and the conversation is routed to a vision-capable free model that can describe, read and reason about it. Documents (PDF, TXT, Markdown, CSV) are handled differently — their text is extracted and analysed in the conversation, as [the file guide](/help-files) explains.",
          "Image creation uses free image sources: a free image-capable model on OpenRouter when one is available, otherwise a free generation service. Every created image carries an invisible Xyro AI watermark and is stored as private Cloudinary media. When no free image source can respond, the app says so honestly instead of faking a result — see [image creation](/help-image-creation).",
        ],
      },
      {
        title: "The catalogue changes — the app is the source of truth",
        body: [
          "Providers adjust their free pools: models arrive, leave, and get busy at peak times. We publish no fixed model list and no benchmark scores, because both would go stale. The live list is always in the chat model picker, in Settings → General, and — for API keys — from `GET /api/v1/models` (see [developers](/developers)).",
          "Free also means shared: at peak times a model can be slow or temporarily unavailable. Xyro AI's answer to that is the fallback chain above, not a quiet switch to anything paid.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I use paid models like the big flagship ones?",
        a: "No. Xyro AI only calls models OpenRouter lists as free. If a flagship model has a free variant in the pool, it appears in the picker while it's free; the paid version is never offered.",
      },
      {
        q: "Which model answers when I choose Auto (Free)?",
        a: "OpenRouter routes the prompt to an available free model at that moment. The model used is shown with the reply, and API responses report it in the usage data on your Developer dashboard.",
      },
      {
        q: "Why did a model disappear from the picker?",
        a: "Its provider changed its free offering. The picker is fed by the live catalogue, so it always reflects what is actually free right now.",
      },
    ],
  },
  "use-cases": {
    title: "What people do with Xyro AI",
    intro:
      "One free workspace, many kinds of work. These pages describe the most common ways people use Xyro AI — with the honest limits of a free service kept in view.",
    cards: [
      { title: "For students", href: "/for-students", blurb: "Understand difficult material, summarise readings, and practise — without outsourcing the thinking." },
      { title: "For writers", href: "/for-writers", blurb: "Draft, restructure and polish long-form work while keeping your own voice." },
      { title: "For creators", href: "/for-creators", blurb: "Ideas, scripts, captions and created images for the channels you publish on." },
      { title: "For developers", href: "/developers", blurb: "An OpenAI-compatible API on the same free models, with 100,000 tokens a day." },
      { title: "For business & teams", href: "/for-business", blurb: "Everyday drafting, summarising and brainstorming for small teams — free, with clear limits." },
    ],
    sections: [
      {
        title: "One workspace, many jobs",
        body: [
          "The pattern is the same whatever the job: ask in plain language, attach a file when the answer depends on one, follow up until it's right, then export or keep the chat for later. Custom instructions (Settings → Personalization) let you teach Xyro AI your context once instead of repeating it in every chat.",
          "New here? [Getting started](/help-getting-started) takes about a minute, and the [models page](/models) explains how to choose between Auto (Free) and a named free model for a given task.",
        ],
      },
      {
        title: "Honest limits for every use case",
        body: [
          "Xyro AI is a free service on free tiers: fair-use limits apply (see [pricing](/pricing)), free models can be busy, and AI answers can be wrong — sometimes confidently. For study, work or publication, treat the output as a strong first draft of the thinking, and keep your own judgment as the final step.",
        ],
      },
    ],
  },
  "for-students": {
    title: "Xyro AI for students",
    intro:
      "A free study partner that explains, summarises and quizzes — built to help you understand your material, not to do your thinking for you.",
    sections: [
      {
        title: "Understand, don't just answer",
        body: [
          "Ask for an explanation at your level: 'Explain entropy like I'm a first-year, then give me a harder version.' Follow up until it clicks, ask for worked examples, and ask the model to quiz you — questions first, answers after you try. That loop is where the learning happens.",
          "Pick a model per task in the chat picker, or stay on Auto (Free). Either way it costs nothing, which matters on a student budget: there is no plan to upgrade to and no card to add.",
        ],
      },
      {
        title: "Work with your readings",
        body: [
          "Attach lecture slides, articles or chapters as PDF, TXT or Markdown (up to 10 MB) and ask for a summary, the key arguments, or the parts most likely to be examined. Images work too — photograph a diagram or a whiteboard and ask what it shows. See [uploading & analysing files](/help-files) for formats and limits.",
          "Chats are saved and searchable, so a revision session from October is still there in January. Rename chats by subject, and export the useful ones from the sidebar.",
        ],
      },
      {
        title: "Your work stays yours",
        body: [
          "Use Xyro AI the way you'd use a tutor: to understand, practise and get feedback on your drafts. Submitting AI output as your own work can breach your institution's rules — and it skips the learning the qualification is meant to certify. Xyro AI doesn't train models on your chats, and you can export or delete everything from Settings at any time (see the [privacy center](/privacy-center)).",
          "Always check facts, quotes and citations against your course materials: models can invent references that look real.",
        ],
      },
    ],
  },
  "for-writers": {
    title: "Xyro AI for writers",
    intro:
      "A drafting partner for articles, essays, newsletters and books — outlining, restructuring and line-level polish, with your voice kept in charge.",
    sections: [
      {
        title: "From blank page to structure",
        body: [
          "Start with the messy version: paste your notes, dictate the argument in rough form, and ask for an outline, three possible openings, or the strongest counter-argument to your own draft. Ask for the structure first and the sentences second — it's a better order, and the chat remembers the thread while you iterate.",
          "Custom instructions (Settings → Personalization) are a writer's best friend here: note your audience, your tone, and the words you never use, and every chat starts from there.",
        ],
      },
      {
        title: "Editing at every level",
        body: [
          "Attach a draft as TXT or Markdown and work at whichever level you need: structural notes on the whole piece, paragraph-by-paragraph tightening, or a final pass for clarity and consistency. Ask 'what would you cut?' as often as 'what would you add?' — and regenerate or stop a reply whenever it drifts from your intent.",
          "Long pieces can live in one chat: history syncs across your devices, and you can export a conversation as Markdown when it's time to move the text into your publishing tool.",
        ],
      },
      {
        title: "Honest notes for writers",
        body: [
          "The models are free ones (see [models](/models)), so long, subtle work benefits from a named model chosen in the picker and from breaking big edits into passes. And the usual rule applies with extra force for publication: facts, names, dates and quotes from a model must be verified before they carry your byline.",
        ],
      },
    ],
  },
  "for-creators": {
    title: "Xyro AI for creators",
    intro:
      "Ideas, scripts, captions and images for people who publish — a free creative partner for the channels you run.",
    sections: [
      {
        title: "Never start from a blank page",
        body: [
          "Brainstorm video angles, hooks, titles and series formats; turn one long idea into a week of posts; draft a script, then ask for a tighter 60-second version and three caption options. Repurposing is where a chat workspace shines: paste the source once, then ask for every format you need.",
          "Attach a photo and ask what works in it, or describe the thumbnail you're imagining and refine the words before you design it.",
        ],
      },
      {
        title: "Create images in the chat",
        body: [
          "The composer's + menu has 'Create an image': describe the picture and Xyro AI generates it with a free image source, right inside the conversation (10 creations a day). Every created image carries an invisible Xyro AI watermark and is stored as your private media — the watermark is a provenance signal, explained honestly on the [XyroAIDetect page](/xyroaidetect), including its limits.",
          "When no free image source is available at that moment, the app says so instead of faking a result. See [image creation](/help-image-creation) for the details.",
        ],
      },
      {
        title: "Keep your voice, check your facts",
        body: [
          "Set your tone, your audience and your recurring formats as custom instructions (Settings → Personalization) so drafts start close to your style. Then edit like it matters — because audiences can tell. And verify claims, stats and quotes before publishing: models can be confidently wrong, and it's your name on the post.",
        ],
      },
    ],
  },
  "for-business": {
    title: "Xyro AI for business & teams",
    intro:
      "Everyday AI help for small businesses and teams — drafting, summarising and brainstorming on a free service, with the limits stated plainly.",
    sections: [
      {
        title: "Useful from the first morning",
        body: [
          "Draft the email, summarise the report, turn meeting notes into actions, brainstorm campaign angles, prepare for the negotiation. Attach the PDF or spreadsheet export (PDF, TXT, Markdown, CSV up to 10 MB) and ask the questions you'd ask a sharp colleague: what are the risks, what's missing, what should we do first?",
          "Each person uses their own free account; chats sync across their devices, and custom instructions can hold the shared context — your products, your tone, your market — so drafts start on-brief.",
        ],
      },
      {
        title: "The developer option",
        body: [
          "Need the models inside your own tool or workflow? The [developer API](/developers) is OpenAI-compatible: activate it in Settings → Developer, name a key, and call the same free models with 100,000 tokens a day on the free plan, with a usage dashboard and per-request logs.",
        ],
      },
      {
        title: "Honest limits for business use",
        body: [
          "Xyro AI is a free service, and this page won't pretend otherwise:",
          "- Accounts are individual today — there is no shared team workspace, central billing or admin console for your organisation yet (it's on the [roadmap](/roadmap) as exploring)",
          "- Fair-use limits apply per account (see [pricing](/pricing)), and free models can be busy at peak times",
          "- Prompts are processed by OpenRouter and the selected model provider under their policies (see [subprocessors](/subprocessors)) — keep regulated or highly sensitive data out, as you would with any external tool",
          "What you do get is real control over your own data: export or delete chats, files or the whole account at any time from Settings (see the [privacy center](/privacy-center)).",
        ],
      },
    ],
  },
  roadmap: {
    title: "Where Xyro AI is heading",
    intro:
      "Directions, not promises. Everything on this page is labelled planned or exploring, carries no date, and may change as free tiers, models and feedback evolve. What has actually shipped is on the [changelog](/changelog).",
    sections: [
      {
        title: "Planned",
        body: [
          "- Streaming responses for the public API (the API is request/response today; chat in the app already streams)",
          "- More free models in the picker as providers add them to OpenRouter's free pool — this happens continuously and needs no announcement",
          "- Richer file analysis: more document types and better handling of large PDFs within free-tier limits",
          "- The XyroAIDetect upload tool, with its behaviour published before launch (see [XyroAIDetect](/xyroaidetect))",
        ],
      },
      {
        title: "Exploring",
        body: [
          "- Shared workspaces for teams, so a group can keep chats and context together (accounts are individual today)",
          "- An installable-app experience with offline access to your recent chats",
          "- More languages in the interface, following the languages our users actually write in",
          "- Deeper usage insights in the Developer dashboard, building on the per-model and per-key data already collected",
        ],
      },
      {
        title: "What won't change",
        body: [
          "The commitments the product was built on stay: free models only, no card, honest limits stated in plain language, and your data exportable and deletable at any time. If a direction ever conflicts with those, the direction loses. Suggest a direction of your own via the [contact page](/contact).",
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

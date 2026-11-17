import { serverEnv } from "@/lib/server/env";
import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { guardMutationHeaders } from "@/lib/server/auth-guard";
import { getBudgetStatus, recordBudget } from "@/lib/server/budget";
import {
  getCloudinaryPrivateDownloadUrl,
  uploadGeneratedImage, cloudinaryErrorMessage } from "@/lib/server/cloudinary";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";
import { limitDeniedResponse, limit as rateLimit } from "@/lib/server/limit";
import { getFreeImageModels } from "@/lib/server/models";
import { recordUsageEvent } from "@/lib/server/analytics";
import { authenticateVerifiedUser } from "@/lib/server/request-auth";
import { buildWatermarkPayload, embedWatermark } from "@/lib/server/watermark";

// Image creation (Phase 7, extended in the robustness round).
//
// POST { chatId, prompt, userMessageId, assistantMessageId } creates
// one image in a chat:
//  1. Image sources, in order — both free, no paid model is ever
//     called: (a) the Pollinations free generation service FIRST
//     (no key, no quota bookkeeping, answers immediately — the
//     owner asked for instant switching to Pollinations); (b) a
//     FREE image-generation model from the live OpenRouter
//     catalogue (output modality "image") as backup, when one
//     exists. If both sources fail the route answers 503 and the
//     UI says so plainly — no result is faked.
//  2. The returned image is downloaded server-side, passed through
//     the invisible LSB watermark (lib/server/watermark.ts), and the
//     WATERMARKED PNG is stored in Cloudinary as an authenticated
//     asset under xyro/generated/{uid}. The original is not kept.
//  3. The picture is recorded as a normal upload document
//     (kind: "generated") and attached to a new assistant message,
//     so it renders in the chat thread, appears in Settings → Data
//     files, and is deleted by the existing cascades.
//
// Limits: 10 creations per user per day (fail closed), on top of the
// session + verified-email + Origin/header guards every app API
// uses. Generation also pauses with the daily budget guard.

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 8192;
const MAX_PROMPT_LENGTH = 2000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 55_000;

const IMAGE_UNAVAILABLE_MESSAGE =
  "Image creation is temporarily unavailable — the free image services didn’t return an image. Please try again in a moment.";

function errorResponse(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Pull the first image reference out of an OpenRouter chat completion. */
function findImageReference(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown })?.message;
  if (typeof message !== "object" || message === null) return null;

  const images = (message as { images?: unknown }).images;
  if (Array.isArray(images)) {
    for (const image of images) {
      const url = (image as { image_url?: { url?: unknown } })?.image_url?.url;
      if (typeof url === "string" && url.length > 0) return url;
    }
  }
  const content = (message as { content?: unknown }).content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const imageUrl = (part as { image_url?: { url?: unknown } }).image_url?.url;
      if (typeof imageUrl === "string" && imageUrl.length > 0) return imageUrl;
      const inline = (part as { b64_json?: unknown }).b64_json;
      if (typeof inline === "string" && inline.length > 0) {
        return `data:image/png;base64,${inline}`;
      }
    }
  }
  if (typeof content === "string") {
    const dataUrl = content.match(/data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+/);
    if (dataUrl) return dataUrl[0];
  }
  return null;
}

// SSRF hardening for the model-returned URL (Phase 9 audit): the URL
// comes from a model response that the caller's prompt can influence,
// so it is untrusted input. Only https is allowed, redirects are
// refused (a redirect could bounce the request to an internal target),
// IP-literal hosts in private/loopback/link-local ranges and local
// hostnames are rejected, and the body is read with a hard cap instead
// of buffering an unbounded response into memory. Hostnames are not
// DNS-resolved here, so a public hostname that resolves to a private
// address (DNS rebinding) remains a documented residual risk in
// SECURITY.md; the response bytes are additionally parsed as an image
// by the watermark step and are never returned to the caller.
function isBlockedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (host.includes(":")) {
    // IPv6 literal: only allow global unicast (2xxx); block ::1, fe80::/10,
    // fc00::/7 and IPv4-mapped forms outright.
    return !/^[23]/.test(host);
  }
  return false;
}

async function downloadImage(reference: string): Promise<Buffer> {
  if (reference.startsWith("data:")) {
    const comma = reference.indexOf(",");
    const header = comma > 0 ? reference.slice(0, comma) : "";
    if (!/^data:image\/[a-z+.-]+;base64$/.test(header)) {
      throw new Error("The model returned an image we couldn’t read.");
    }
    const bytes = Buffer.from(reference.slice(comma + 1), "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("The model returned an image of an unexpected size.");
    }
    return bytes;
  }
  if (reference.startsWith("https://")) {
    let url: URL;
    try {
      url = new URL(reference);
    } catch {
      throw new Error("The model returned an image we couldn’t read.");
    }
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      isBlockedImageHost(url.hostname)
    ) {
      throw new Error("The model returned an image we couldn’t read.");
    }
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error("The generated image couldn’t be downloaded.");
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
      throw new Error("The model returned an image of an unexpected size.");
    }
    if (!response.body) {
      throw new Error("The generated image couldn’t be downloaded.");
    }
    // Streamed read with a hard cap: never buffer more than
    // MAX_IMAGE_BYTES + one chunk, however much the server sends.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("The model returned an image of an unexpected size.");
      }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.byteLength === 0) {
      throw new Error("The model returned an image of an unexpected size.");
    }
    return bytes;
  }
  throw new Error("The model returned an image we couldn’t read.");
}

/**
 * Primary image source: the Pollinations free generation service
 * (no API key). The host is fixed, the prompt travels in the URL
 * path, and the response must be an image within the size cap; the
 * bytes are additionally parsed by the watermark step before they
 * are stored or shown, so a non-image response can never reach a
 * user.
 */
async function fetchPollinationsImage(prompt: string): Promise<Buffer> {
  // The classic free tier queues and answers 503 "at its limit"
  // under load, suggesting a ~10s retry — so: three attempts with
  // real backoff, a fresh seed each time, and the default model
  // (the named-model queues saturate first).
  const RETRY_DELAYS_MS = [2_000, 8_000];
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const seed = Math.floor(Math.random() * 1_000_000) + 1;
      const url =
        `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
        `?width=1024&height=1024&seed=${seed}&nologo=true`;
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(75_000),
        headers: { Accept: "image/*" },
      });
      if (!response.ok) {
        throw new Error(`Pollinations answered ${response.status}.`);
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/") || !response.body) {
        throw new Error("Pollinations did not return an image.");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_IMAGE_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new Error("The generated image was unexpectedly large.");
        }
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.byteLength === 0) {
        throw new Error("Pollinations returned an empty image.");
      }
      return bytes;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Pollinations failed.");
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAYS_MS[attempt]),
        );
      }
    }
  }
  throw lastError ?? new Error("Pollinations failed.");
}

export async function POST(request: NextRequest) {
  const guard = guardMutationHeaders(request);
  if (guard) return guard;
  const auth = await authenticateVerifiedUser(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);

  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  const contentLength = Number(request.headers.get("content-length"));
  if (
    contentType !== "application/json" ||
    (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES)
  ) {
    return errorResponse(400, "INVALID_REQUEST", "The image request isn’t valid.");
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return errorResponse(400, "INVALID_REQUEST", "The image request is too large.");
    }
    body = JSON.parse(raw);
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "The image request isn’t valid JSON.");
  }

  const fields = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  const { chatId, userMessageId, assistantMessageId } = fields;
  const prompt = typeof fields.prompt === "string" ? fields.prompt.trim() : "";
  if (
    !isUuid(chatId) ||
    !isUuid(userMessageId) ||
    !isUuid(assistantMessageId) ||
    userMessageId === assistantMessageId ||
    prompt.length === 0 ||
    prompt.length > MAX_PROMPT_LENGTH
  ) {
    return errorResponse(
      400,
      "INVALID_PROMPT",
      `Describe the image in 1–${MAX_PROMPT_LENGTH} characters, in a valid conversation.`,
    );
  }

  // Conservative creation limit: 10 per user per day, fail closed —
  // each creation spends shared free-tier model + Cloudinary quota.
  const limitResult = await rateLimit(
    `images:generate:user:${auth.uid}`,
    24 * 60 * 60 * 1000,
    10,
    "closed",
  );
  if (!limitResult.allowed) {
    const denied = limitDeniedResponse(limitResult);
    return errorResponse(
      denied.status,
      denied.code,
      denied.status === 429
        ? "You’ve reached today’s image creation limit (10 per day). Please try again tomorrow."
        : denied.message,
      denied.retryAfter ? { "Retry-After": String(denied.retryAfter) } : undefined,
    );
  }

  const budget = await getBudgetStatus();
  if (budget.state === "paused") {
    return errorResponse(
      503,
      "BUDGET_PAUSED",
      "Image creation is paused for today because the service has reached its daily capacity. Please come back tomorrow.",
      { "Retry-After": "1800" },
    );
  }

  const apiKey = serverEnv.openRouterApiKey;
  // Free OpenRouter image models, checked against the live
  // catalogue at request time — the BACKUP source, tried only when
  // Pollinations fails. The list is usually empty (no free image
  // models exist), in which case Pollinations is the only source.
  const imageModels = await getFreeImageModels().catch(() => []);

  let db: ReturnType<typeof getFirebaseAdminFirestore>;
  try {
    db = getFirebaseAdminFirestore();
  } catch (error) {
    console.error("Firebase storage is not configured for image creation.", error);
    return errorResponse(503, "IMAGE_STORAGE_NOT_CONFIGURED", "Image storage isn’t configured for this deployment.");
  }

  const userRef = db.collection("users").doc(auth.uid);
  const chatRef = userRef.collection("chats").doc(chatId);
  const messagesRef = chatRef.collection("messages");
  try {
    const chatSnapshot = await chatRef.get();
    if (!chatSnapshot.exists) {
      return errorResponse(404, "CHAT_NOT_FOUND", "This conversation no longer exists.");
    }
    if ((await messagesRef.doc(assistantMessageId).get()).exists) {
      return errorResponse(409, "MESSAGE_ALREADY_EXISTS", "This image has already been created.");
    }

    // Produce the original image bytes from the first source that
    // answers: Pollinations FIRST (instant, keyless), then a free
    // OpenRouter image model as backup when the catalogue has one.
    // A source that answers without an image is a failure of that
    // source, never a reason to fabricate a result.
    let originalBytes: Buffer | null = null;
    let usedModel = "";

    try {
      originalBytes = await fetchPollinationsImage(prompt);
      usedModel = "pollinations/free";
    } catch (error) {
      console.error("Pollinations image generation failed; trying OpenRouter.", error);
      originalBytes = null;
    }

    if (!originalBytes && apiKey && imageModels.length > 0) {
      let imageReference: string | null = null;
      for (const candidate of imageModels.slice(0, 2)) {
        let response: Response;
        try {
          response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": request.nextUrl.origin,
              "X-Title": "Xyro AI",
            },
            body: JSON.stringify({
              model: candidate.id,
              messages: [{ role: "user", content: prompt }],
              modalities: ["image", "text"],
            }),
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
            cache: "no-store",
          });
        } catch {
          break; // Network trouble: fall through to the fallback source.
        }
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 429 || response.status >= 500) continue;
          break;
        }
        const payload: unknown = await response.json().catch(() => null);
        imageReference = findImageReference(payload);
        if (imageReference) {
          try {
            originalBytes = await downloadImage(imageReference);
            usedModel = candidate.id;
          } catch {
            originalBytes = null;
          }
          break;
        }
      }
    }

    if (!originalBytes) {
      return errorResponse(503, "IMAGE_MODEL_UNAVAILABLE", IMAGE_UNAVAILABLE_MESSAGE);
    }

    // Watermark → store. The watermark is applied BEFORE storage
    // and the original bytes are discarded.
    const generationId = randomUUID();
    let watermarked: Buffer;
    try {
      watermarked = await embedWatermark(
        originalBytes,
        buildWatermarkPayload(generationId, auth.uid),
      );
    } catch (error) {
      console.error("Generated image processing failed.", error);
      return errorResponse(
        502,
        "IMAGE_PROCESSING_FAILED",
        "The generated image couldn’t be processed.",
      );
    }

    let stored: { publicId: string; bytes: number };
    try {
      stored = await uploadGeneratedImage(watermarked, auth.uid, generationId);
    } catch (error) {
      console.error("Generated image storage failed.", error);
      return errorResponse(503, "IMAGE_STORAGE_FAILED", `The generated image couldn’t be saved. (${cloudinaryErrorMessage(error)})`);
    }

    const assetId = randomUUID();
    const name = `xyro-created-${generationId.slice(0, 8)}.png`;
    const attachment = { id: assetId, name, mimeType: "image/png", size: stored.bytes };
    const now = Timestamp.now();
    const chatData = chatSnapshot.data() ?? {};
    const existingTitle = typeof chatData.title === "string" ? chatData.title : "New chat";
    const title =
      existingTitle === "New chat"
        ? prompt.slice(0, 60).replace(/\s+\S*$/, "").trim() || prompt.slice(0, 60)
        : existingTitle;
    const previousSearch = typeof chatData.searchText === "string" ? chatData.searchText : "";
    const batch = db.batch();
    batch.create(userRef.collection("uploads").doc(assetId), {
      assetId,
      chatId,
      name,
      mimeType: "image/png",
      expectedBytes: stored.bytes,
      bytes: stored.bytes,
      format: "png",
      resourceType: "image",
      publicId: stored.publicId,
      deliveryType: "authenticated",
      status: "ready",
      kind: "generated",
      generationId,
      model: usedModel,
      prompt: prompt.slice(0, 500),
      createdAt: now,
      confirmedAt: now,
    });
    batch.create(messagesRef.doc(userMessageId), {
      role: "user",
      content: prompt,
      attachmentIds: [],
      attachments: [],
      status: "complete",
      createdAt: now,
    });
    batch.create(messagesRef.doc(assistantMessageId), {
      role: "assistant",
      content: "Here’s the image you described. It was created with a free model and carries an invisible Xyro AI watermark.",
      attachmentIds: [assetId],
      attachments: [attachment],
      status: "complete",
      inReplyTo: userMessageId,
      kind: "image-generation",
      generationId,
      model: usedModel,
      createdAt: Timestamp.fromMillis(Date.now() + 1),
    });
    batch.set(
      chatRef,
      {
        title,
        searchText: `${previousSearch}\n${prompt}`.slice(-5000),
        lastMessagePreview: "Created an image",
        updatedAt: now,
      },
      { merge: true },
    );
    await batch.commit();

    await recordBudget({
      firestoreWrites: 4,
      firestoreReads: 2,
      redisCommands: 4,
    });
    await recordUsageEvent({
      uid: auth.uid,
      surface: "image",
      model: usedModel,
      promptTokens: 0,
      completionTokens: 0,
      chatId,
    });

    return NextResponse.json(
      {
        success: true,
        assetId,
        generationId,
        model: usedModel,
        messageId: assistantMessageId,
        accessUrl: getCloudinaryPrivateDownloadUrl(stored.publicId, "png", "image"),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Image creation failed.", error);
    return errorResponse(503, "IMAGE_REQUEST_FAILED", "The image couldn’t be created or saved. Please try again.");
  }
}

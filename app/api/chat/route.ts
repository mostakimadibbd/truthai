import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { sortByConversationOrder } from "@/lib/message-order";
import {
  buildOpenRouterMessages,
  type StoredChatMessage,
} from "@/lib/server/chat-attachments";
import {
  getFirebaseAdminDatabase,
  getFirebaseAdminFirestore,
} from "@/lib/server/firebase-admin";
import { guardMutationHeaders } from "@/lib/server/auth-guard";
import { getBudgetStatus, recordBudget } from "@/lib/server/budget";
import { authenticateVerifiedUser } from "@/lib/server/request-auth";
import { checkRateLimit } from "@/lib/server/rate-limit";
import {
  AUTO_MODEL_ID,
  getFreeModels,
  isAllowedFreeModel,
  modelAttemptOrder,
  modelHasVision,
  pickFreeVisionModel,
} from "@/lib/server/models";
import {
  getCustomInstructionsSystemText,
  readPreferences,
} from "@/lib/server/settings";
import {
  MAX_ATTACHMENT_BYTES_PER_MESSAGE,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "@/lib/server/upload-policy";
import {
  OpenRouterAttemptsExhausted,
  fetchChatCompletionWithFallback,
} from "@/lib/server/openrouter";
import { recordUsageEvent } from "@/lib/server/analytics";
import {
  buildWebContext,
  extractUrls,
  hasSearchIntent,
  type WebSource,
} from "@/lib/server/web-search";

export const runtime = "nodejs";
export const maxDuration = 300;

const CHAT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16_384;
const MAX_MESSAGE_LENGTH = 12_000;
const MAX_MESSAGES = 30;
const MAX_TOTAL_LENGTH = 36_000;
const LIVE_UPDATE_INTERVAL_MS = 250;

type RequestBody = {
  chatId?: unknown;
  responseId?: unknown;
  userMessageId?: unknown;
  assistantMessageId?: unknown;
  content?: unknown;
  attachmentIds?: unknown;
  regenerate?: unknown;
  model?: unknown;
  webSearch?: unknown;
};

class ChatRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

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
  return typeof value === "string" && CHAT_ID_PATTERN.test(value);
}

function parseAttachmentIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > MAX_ATTACHMENTS_PER_MESSAGE ||
    value.some((id) => !isUuid(id)) ||
    new Set(value).size !== value.length
  ) {
    return null;
  }
  return value;
}

function parseStoredMessage(
  id: string,
  value: FirebaseFirestore.DocumentData | undefined,
): StoredChatMessage | null {
  if (
    !value ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.content !== "string"
  ) {
    return null;
  }
  const attachmentIds = Array.isArray(value.attachmentIds)
    ? value.attachmentIds.filter((item: unknown): item is string => isUuid(item))
    : [];
  const attachments = Array.isArray(value.attachments)
    ? value.attachments.flatMap((item: unknown) => {
        if (
          typeof item !== "object" ||
          item === null ||
          !("id" in item) ||
          !isUuid(item.id) ||
          !("name" in item) ||
          typeof item.name !== "string" ||
          !("mimeType" in item) ||
          typeof item.mimeType !== "string" ||
          !("size" in item) ||
          typeof item.size !== "number"
        ) {
          return [];
        }
        return [{
          id: item.id,
          name: item.name,
          mimeType: item.mimeType,
          size: item.size,
        }];
      })
    : [];
  return { id, role: value.role, content: value.content, attachmentIds, attachments };
}

type StreamDelta = {
  text?: string;
  done?: boolean;
  error?: string;
  usage?: { promptTokens: number; completionTokens: number };
  model?: string;
};

function parseDelta(line: string): StreamDelta {
  if (!line.startsWith("data:")) return {};
  const payload = line.slice(5).trim();
  if (!payload) return {};
  if (payload === "[DONE]") return { done: true };

  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return { error: "The model returned a response we couldn’t read." };
  }
  if (typeof event !== "object" || event === null) return {};
  if (
    "error" in event &&
    typeof event.error === "object" &&
    event.error !== null &&
    "message" in event.error &&
    typeof event.error.message === "string"
  ) {
    return { error: "The free model could not process this request. Try again or remove an attachment." };
  }
  // Usage + model ride along on the stream's chunks (the final
  // chunk carries the totals when usage was requested); capture
  // them independently of the text delta below.
  const meta: StreamDelta = {};
  if ("model" in event && typeof event.model === "string") {
    meta.model = event.model;
  }
  if (
    "usage" in event &&
    typeof event.usage === "object" &&
    event.usage !== null &&
    "prompt_tokens" in event.usage &&
    typeof event.usage.prompt_tokens === "number" &&
    "completion_tokens" in event.usage &&
    typeof event.usage.completion_tokens === "number"
  ) {
    meta.usage = {
      promptTokens: event.usage.prompt_tokens,
      completionTokens: event.usage.completion_tokens,
    };
  }
  if (!("choices" in event) || !Array.isArray(event.choices)) return meta;
  const choice = event.choices[0];
  if (
    typeof choice !== "object" ||
    choice === null ||
    !("delta" in choice) ||
    typeof choice.delta !== "object" ||
    choice.delta === null ||
    !("content" in choice.delta)
  ) {
    return meta;
  }
  if (typeof choice.delta.content === "string") {
    return { ...meta, text: choice.delta.content };
  }
  if (Array.isArray(choice.delta.content)) {
    const text = choice.delta.content.flatMap((part: unknown) =>
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
        ? [part.text]
        : [],
    ).join("");
    return { ...meta, text };
  }
  return meta;
}

export async function POST(request: NextRequest) {
  const guard = guardMutationHeaders(request);
  if (guard) return guard;
  const auth = await authenticateVerifiedUser(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return errorResponse(
      503,
      "CHAT_NOT_CONFIGURED",
      "AI chat isn’t configured yet. Add an OpenRouter API key on the server to enable responses.",
    );
  }

  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  const contentLength = Number(request.headers.get("content-length"));
  if (
    contentType !== "application/json" ||
    (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES)
  ) {
    return errorResponse(400, "INVALID_REQUEST", "The chat request isn’t valid.");
  }

  let body: RequestBody;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return errorResponse(400, "INVALID_REQUEST", "The chat request is too large.");
    }
    body = JSON.parse(raw) as RequestBody;
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "The chat request isn’t valid JSON.");
  }

  const {
    chatId,
    responseId,
    userMessageId,
    assistantMessageId,
    content,
    regenerate = false,
  } = body;
  const attachmentIds = parseAttachmentIds(body.attachmentIds);
  if (
    !isUuid(chatId) ||
    !isUuid(responseId) ||
    !isUuid(userMessageId) ||
    !isUuid(assistantMessageId) ||
    userMessageId === assistantMessageId ||
    typeof content !== "string" ||
    content.length > MAX_MESSAGE_LENGTH ||
    (content.trim().length === 0 && (!attachmentIds || attachmentIds.length === 0)) ||
    attachmentIds === null ||
    typeof regenerate !== "boolean"
  ) {
    return errorResponse(
      400,
      "INVALID_MESSAGE",
      "Send a message or attachment using a valid conversation.",
    );
  }

  // Model selection (Phase 3): an explicit model must be on the free
  // list; when none is sent, the user's default-model preference is
  // used (itself validated, falling back to Auto (Free) if the stored
  // value is no longer a free model).
  let requestedModel: string | null = null;
  if (body.model !== undefined) {
    if (
      typeof body.model !== "string" ||
      body.model.length === 0 ||
      body.model.length > 200 ||
      !(await isAllowedFreeModel(body.model))
    ) {
      return errorResponse(
        400,
        "INVALID_MODEL",
        "Choose one of the free models from the model list.",
      );
    }
    requestedModel = body.model;
  }

  const rateLimit = await checkRateLimit(auth.uid, "chat", 10, 60);
  if (rateLimit.state === "unavailable") {
    return errorResponse(
      503,
      "CAPACITY_GUARD_UNAVAILABLE",
      "Chat is temporarily unavailable because its capacity guard couldn’t be reached.",
    );
  }
  if (rateLimit.state === "limited") {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "You’ve reached the chat limit. Please wait before sending another message.",
      { "Retry-After": String(rateLimit.retryAfter) },
    );
  }

  // Daily budget guard (Phase 4): at >=95% of the estimated daily
  // Firestore write budget, new turns pause; at >=85% they are
  // queued (429 BUDGET_QUEUE — the client shows a queued/retrying
  // state and retries, rather than treating it as a failure). When
  // Redis is unconfigured the guard is skipped (see budget.ts).
  const budget = await getBudgetStatus();
  if (budget.state === "paused") {
    return errorResponse(
      503,
      "BUDGET_PAUSED",
      "Chat is paused for today because the service has reached its daily capacity. Please come back tomorrow.",
      { "Retry-After": "1800" },
    );
  }
  if (budget.state === "queue") {
    return errorResponse(
      429,
      "BUDGET_QUEUE",
      "You’re in a short queue — today’s capacity is nearly full. Your message will be retried shortly.",
      { "Retry-After": "30" },
    );
  }

  let db: ReturnType<typeof getFirebaseAdminFirestore>;
  let realtimeDb: ReturnType<typeof getFirebaseAdminDatabase>;
  try {
    db = getFirebaseAdminFirestore();
    realtimeDb = getFirebaseAdminDatabase();
  } catch (error) {
    console.error("Firebase chat storage is not configured.", error);
    return errorResponse(503, "CHAT_STORAGE_NOT_CONFIGURED", "Firestore and Realtime Database are required for chat.");
  }

  const chatRef = db.collection("users").doc(auth.uid).collection("chats").doc(chatId);
  const messagesRef = chatRef.collection("messages");
  const streamRef = realtimeDb.ref(`chatStreams/${auth.uid}/${chatId}`);
  const assistantRef = messagesRef.doc(assistantMessageId);
  let responseText = "";
  let webSources: WebSource[] = [];
  // Live-stream phase shown in the client ("Searching the web…"
  // while the search chain runs, "Thinking" otherwise).
  let streamPhase: "searching" | "thinking" = "thinking";
  // Set when a web block was spliced into the model messages; the
  // pre-web snapshot lets a rejected request retry without it.
  let webContextInjected = false;
  let locked = false;
  let assistantCreated = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let assistantSaved = false;
  let modelMessages: StoredChatMessage[] = [];

  try {
    const chatSnapshot = await chatRef.get();
    if (!chatSnapshot.exists) {
      throw new ChatRouteError(404, "CHAT_NOT_FOUND", "This conversation no longer exists.");
    }
    const chatData = chatSnapshot.data();
    if (!chatData) {
      throw new ChatRouteError(500, "CHAT_STORAGE_INVALID", "This conversation couldn’t be read.");
    }

    const historySnapshot = await messagesRef
      .orderBy("createdAt", "asc")
      .limitToLast(regenerate ? MAX_MESSAGES : MAX_MESSAGES - 1)
      .get();
    // Stored pairs can share a createdAt millisecond (they are
    // written in one batch); Firestore breaks the tie by document
    // id, scrambling question/answer order in the model context.
    // Re-apply the deterministic conversation order.
    const orderedHistoryDocs = sortByConversationOrder(
      historySnapshot.docs,
      (doc) => doc.data().createdAt?.toMillis?.() ?? 0,
      (doc) => (doc.data().role === "assistant" ? "assistant" : "user"),
    );
    let history = orderedHistoryDocs.flatMap((snapshot) => {
      const message = parseStoredMessage(snapshot.id, snapshot.data());
      return message ? [message] : [];
    });

    let newUserMessage: StoredChatMessage | null = null;
    let oldAssistantId: string | null = null;
    if (regenerate) {
      const lastUser = [...history].reverse().find((message) => message.role === "user");
      if (!lastUser || lastUser.id !== userMessageId) {
        throw new ChatRouteError(400, "REGENERATE_NOT_ALLOWED", "Only the latest user message can be regenerated.");
      }
      const last = history.at(-1);
      if (last?.role === "assistant") {
        const lastSnapshot = orderedHistoryDocs.at(-1);
        const replyTo = lastSnapshot?.data().inReplyTo;
        if (typeof replyTo === "string" && replyTo !== userMessageId) {
          throw new ChatRouteError(400, "REGENERATE_NOT_ALLOWED", "Only the latest response can be regenerated.");
        }
        oldAssistantId = last.id;
        history = history.slice(0, -1);
      }
      newUserMessage = lastUser;
    } else {
      if (content.trim().length === 0 && attachmentIds.length === 0) {
        throw new ChatRouteError(400, "INVALID_MESSAGE", "Write a message or attach a file.");
      }
      if (await messagesRef.doc(userMessageId).get().then((snapshot) => snapshot.exists)) {
        throw new ChatRouteError(409, "MESSAGE_ALREADY_EXISTS", "This message has already been sent.");
      }

      const attachments = await Promise.all(attachmentIds.map(async (assetId) => {
        const upload = await db.collection("users").doc(auth.uid)
          .collection("uploads").doc(assetId).get();
        const data = upload.data();
        if (
          !data ||
          data.status !== "ready" ||
          data.chatId !== chatId ||
          typeof data.name !== "string" ||
          typeof data.mimeType !== "string" ||
          typeof data.bytes !== "number"
        ) {
          throw new ChatRouteError(400, "INVALID_ATTACHMENT", "One of these files isn’t ready for this conversation.");
        }
        return { id: assetId, name: data.name, mimeType: data.mimeType, size: data.bytes };
      }));
      const attachmentBytes = attachments.reduce((total, attachment) => total + attachment.size, 0);
      if (attachmentBytes > MAX_ATTACHMENT_BYTES_PER_MESSAGE) {
        throw new ChatRouteError(413, "ATTACHMENTS_TOO_LARGE", "Attachments in one message can total no more than 20 MB.");
      }

      newUserMessage = {
        id: userMessageId,
        role: "user",
        content: content.trim(),
        attachmentIds,
        attachments,
      };
    }

    if (!newUserMessage) {
      throw new ChatRouteError(400, "INVALID_MESSAGE", "This message couldn’t be loaded.");
    }

    const existingAssistant = await assistantRef.get();
    if (existingAssistant.exists) {
      throw new ChatRouteError(409, "MESSAGE_ALREADY_EXISTS", "This response has already been started.");
    }

    const now = Date.now();
    const transaction = await streamRef.transaction((current) => {
      if (
        typeof current === "object" &&
        current !== null &&
        current.status === "generating" &&
        typeof current.updatedAt === "number" &&
        now - current.updatedAt < 5 * 60 * 1000
      ) {
        return;
      }
      return {
        responseId,
        messageId: assistantMessageId,
        status: "generating",
        text: "",
        seq: 0,
        updatedAt: now,
      };
    });
    if (!transaction.committed) {
      throw new ChatRouteError(409, "RESPONSE_IN_PROGRESS", "A response is already being generated in this chat.");
    }
    locked = true;

    // One timestamp for the pair, with the reply stamped 1 ms later
    // (the convention image generation already used), so createdAt
    // ordering can never place a reply before its message.
    const pairCreatedAt = Timestamp.now();
    const replyCreatedAt = Timestamp.fromMillis(pairCreatedAt.toMillis() + 1);
    const batch = db.batch();
    if (oldAssistantId) batch.delete(messagesRef.doc(oldAssistantId));
    if (!regenerate) {
      const userMessageRef = messagesRef.doc(userMessageId);
      batch.create(userMessageRef, {
        role: "user",
        content: newUserMessage.content,
        attachmentIds: newUserMessage.attachmentIds,
        attachments: newUserMessage.attachments,
        status: "complete",
        createdAt: pairCreatedAt,
      });
    }
    batch.create(assistantRef, {
      role: "assistant",
      content: "",
      attachmentIds: [],
      attachments: [],
      status: "generating",
      inReplyTo: userMessageId,
      createdAt: replyCreatedAt,
    });

    const existingTitle = typeof chatData.title === "string" ? chatData.title : "New chat";
    const proposedTitle =
      newUserMessage.content.slice(0, 60).replace(/\s+\S*$/, "").trim() ||
      newUserMessage.content.slice(0, 60) ||
      newUserMessage.attachments[0]?.name.slice(0, 60) ||
      "File conversation";
    const title = existingTitle === "New chat" ? proposedTitle : existingTitle;
    const attachmentSearch = newUserMessage.attachments.map((item) => item.name).join(" ");
    const previousSearch = typeof chatData.searchText === "string" ? chatData.searchText : "";
    const searchText = `${previousSearch}\n${newUserMessage.content}\n${attachmentSearch}`.slice(-5000);
    batch.set(chatRef, {
      title,
      searchText,
      lastMessagePreview: newUserMessage.content.slice(0, 300) || attachmentSearch.slice(0, 300),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    await batch.commit();
    assistantCreated = true;

    const contextMessages = regenerate
      ? [...history]
      : [...history, newUserMessage];
    modelMessages = contextMessages.slice(-MAX_MESSAGES);
    let totalLength = modelMessages.reduce((total, message) => total + message.content.length, 0);
    while (totalLength > MAX_TOTAL_LENGTH && modelMessages.length > 1) {
      totalLength -= modelMessages.shift()?.content.length ?? 0;
    }
    let prepared: Awaited<ReturnType<typeof buildOpenRouterMessages>>;
    try {
      prepared = await buildOpenRouterMessages(db, auth.uid, chatId, modelMessages);
    } catch (error) {
      throw new ChatRouteError(
        422,
        "ATTACHMENT_PROCESSING_FAILED",
        error instanceof Error ? error.message : "The attachment couldn’t be read.",
      );
    }

    // Custom instructions (Phase 3): injected as a system message right
    // after the built-in safety system message, when the user enabled
    // them. Cached server-side for 60 s; failures never block chat.
    const instructions = await getCustomInstructionsSystemText(auth.uid);
    if (instructions) {
      prepared.messages.splice(1, 0, { role: "system", content: instructions });
    }

    // Web search + link reading (2026-11-16, smart-search round):
    // search runs when the composer's toggle is on OR the message
    // itself asks for live data (search/research/latest/news/price…)
    // — the "smart think" trigger — and any links in the message are
    // read either way. While the chain runs, the live stream shows
    // "Searching the web…" in the client. Every attempt is logged to
    // searchEvents (owner requirement: all logs in the DB). Results
    // ride as a capped system block; if a search was attempted but
    // came back empty, the model gets an honesty note instead of
    // improvising around a search that never happened.
    let messagesBeforeWeb: typeof prepared.messages | null = null;
    const toggleSearch = body.webSearch === true;
    const effectiveUserText = regenerate
      ? ([...history].reverse().find((message) => message.role === "user")?.content ?? "")
      : content;
    const autoSearch = !toggleSearch && hasSearchIntent(effectiveUserText);
    const searchTrigger: "toggle" | "auto" | "link" | null =
      toggleSearch
        ? "toggle"
        : autoSearch
          ? "auto"
          : extractUrls(effectiveUserText).length > 0
            ? "link"
            : null;
    if (searchTrigger) {
      streamPhase = "searching";
      void streamRef
        .set({
          responseId,
          messageId: assistantMessageId,
          status: "generating",
          text: "",
          phase: streamPhase,
          seq: 0,
          updatedAt: Date.now(),
        })
        .catch(() => undefined);
      try {
        const web = await buildWebContext({
          searchEnabled: searchTrigger !== "link",
          message: effectiveUserText,
        });
        // All search activity is saved (best-effort; never blocks).
        void db
          .collection("searchEvents")
          .add({
            uid: auth.uid,
            chatId,
            query: web.query,
            trigger: searchTrigger,
            provider: web.provider,
            resultCount: web.resultCount,
            sources: web.sources.slice(0, 6),
            ts: Date.now(),
            createdAt: Timestamp.now(),
          })
          .catch(() => undefined);
        messagesBeforeWeb = [...prepared.messages];
        if (web.context) {
          prepared.messages.splice(instructions ? 2 : 1, 0, {
            role: "system",
            content: web.context,
          });
          webSources = web.sources;
          webContextInjected = true;
        } else if (searchTrigger !== "link") {
          // Search was attempted and returned nothing: tell the
          // model plainly instead of letting it improvise.
          prepared.messages.splice(instructions ? 2 : 1, 0, {
            role: "system",
            content:
              "LIVE SEARCH NOTE: a web search was attempted for this message but returned no results (the search service may be briefly unavailable). If the user needs current information, say plainly that live search didn't return results this time, then answer from your own knowledge and note it may be out of date. Do not claim you searched or invent current facts.",
          });
          webContextInjected = true;
        }
      } catch (error) {
        console.error("Web context failed; continuing without it.", error);
      } finally {
        streamPhase = "thinking";
      }
    }

    let effectiveModel = requestedModel ?? AUTO_MODEL_ID;
    if (!requestedModel) {
      try {
        const preferences = await readPreferences(auth.uid);
        effectiveModel = (await isAllowedFreeModel(preferences.defaultModel))
          ? preferences.defaultModel
          : AUTO_MODEL_ID;
      } catch (error) {
        console.error("Couldn’t read the default-model preference.", error);
        effectiveModel = AUTO_MODEL_ID;
      }
    }

    // Vision routing (Phase 7): when the context carries image
    // attachments, the answering model must actually be able to see
    // images. If the chosen model can't, switch to a free
    // vision-capable model from the live catalogue. If none is
    // available, the image parts are removed and a plain note is
    // added to the prompt so the model tells the user it can't view
    // the images — an attachment is never silently dropped.
    if (prepared.includesImages) {
      const { models: catalogue } = await getFreeModels();
      const chosenCanSee =
        effectiveModel !== AUTO_MODEL_ID &&
        modelHasVision(catalogue, effectiveModel);
      if (!chosenCanSee) {
        const visionModel = pickFreeVisionModel(catalogue);
        if (visionModel) {
          effectiveModel = visionModel.id;
        } else {
          for (const message of prepared.messages) {
            if (message.role !== "user" || !Array.isArray(message.content)) {
              continue;
            }
            const kept = message.content.filter(
              (part) => part.type !== "image_url",
            );
            const note =
              "[Note: the user attached one or more images, but no vision-capable free model is available right now, so you cannot see them. Say so plainly and answer as best you can from the text.]";
            const textPart = kept.find((part) => part.type === "text");
            if (textPart && textPart.type === "text") {
              textPart.text = `${textPart.text}\n\n${note}`;
            } else {
              kept.unshift({ type: "text", text: note });
            }
            message.content = kept.length === 1 && kept[0].type === "text"
              ? kept[0].text
              : kept;
          }
        }
      }
    }

    // Live-stream state (Phase 5 hardening): every published node
    // carries a monotonically increasing seq plus the responseId, so
    // duplicated, reordered or stale Realtime Database events can
    // never rewind or corrupt the visible reply.
    let lastPublishedAt = 0;
    let streamDone = false;
    let streamSeq = 0;
    // A holder object (not bare lets): the stream-line closure
    // assigns these, and property reads are not narrowed away by
    // the type checker the way closure-assigned variables are.
    const streamMeta: {
      usage: { promptTokens: number; completionTokens: number } | null;
      model: string | null;
    } = { usage: null, model: null };
    async function publishLive(force: boolean) {
      const currentTime = Date.now();
      if (!force && currentTime - lastPublishedAt < LIVE_UPDATE_INTERVAL_MS) return;
      streamSeq += 1;
      await streamRef.set({
        responseId,
        messageId: assistantMessageId,
        status: "generating",
        text: responseText,
        phase: streamPhase,
        seq: streamSeq,
        updatedAt: currentTime,
      });
      lastPublishedAt = currentTime;
    }

    // Heartbeat: while the models are being tried and while a reply
    // is generating, republish the stream node every 8 seconds even
    // when no new text has arrived. Free models can think for a long
    // time before the first token; without this the client's stall
    // detection mistook a slow model for a dead one.
    heartbeat = setInterval(() => {
      void publishLive(true).catch(() => undefined);
    }, 8_000);
    void publishLive(true).catch(() => undefined);

    // Walk the fallback chain (chosen model → Auto router → curated
    // free models) with backoff between attempts — free models
    // rate-limit and drop out constantly, and a single retry was
    // not enough. Each attempt has a connect timeout only, so a
    // long streamed reply is never killed mid-generation.
    const attempts = modelAttemptOrder(effectiveModel);
    const acquireUpstream = async (messages: typeof prepared.messages) => {
      const result = await fetchChatCompletionWithFallback({
        apiKey,
        attempts,
        messages,
        stream: true,
        maxTokens: 4096,
        signal: request.signal,
        referer: request.nextUrl.origin,
        title: "Xyro AI",
        connectTimeoutMs: 25_000,
        includeUsage: true,
      });
      return result.response;
    };
    let upstream: Response | null = null;
    let acquireError: unknown = null;
    try {
      upstream = await acquireUpstream(prepared.messages);
    } catch (error) {
      acquireError = error;
    }
    // If the model chain rejected a request that carried the web
    // block (an oversized context is the usual cause), retry once
    // without it — a plain answer beats a dead error.
    if (
      webContextInjected &&
      messagesBeforeWeb &&
      !request.signal.aborted &&
      (acquireError !== null || (upstream !== null && !upstream.ok))
    ) {
      if (upstream && !upstream.ok) {
        await upstream.body?.cancel().catch(() => undefined);
      }
      console.error("Model request with web context failed; retrying without it.");
      upstream = null;
      acquireError = null;
      try {
        upstream = await acquireUpstream(messagesBeforeWeb);
      } catch (error) {
        acquireError = error;
      }
    }
    if (acquireError !== null) {
      const error = acquireError;
      if (request.signal.aborted) {
        throw new ChatRouteError(499, "RESPONSE_STOPPED", "Response stopped.");
      }
      if (error instanceof OpenRouterAttemptsExhausted) {
        const busy = error.lastStatus === 429;
        throw new ChatRouteError(
          busy ? 429 : 503,
          busy ? "MODEL_BUSY" : "MODEL_UNAVAILABLE",
          busy
            ? "Free models are busy right now. Please wait a moment and try again."
            : "The free model service is temporarily unavailable.",
          error.retryAfter ? { "Retry-After": error.retryAfter } : undefined,
        );
      }
      throw new ChatRouteError(502, "MODEL_UNAVAILABLE", "The free model service is temporarily unavailable.");
    }
    if (!upstream || !upstream.ok) {
      if (upstream) await upstream.body?.cancel().catch(() => undefined);
      throw new ChatRouteError(
        502,
        "MODEL_REQUEST_FAILED",
        "The model couldn’t process this request. Try again or remove an attachment.",
      );
    }
    if (!upstream.body) {
      throw new ChatRouteError(502, "MODEL_UNAVAILABLE", "The free model service is temporarily unavailable.");
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    async function handleLine(line: string) {
      const delta = parseDelta(line);
      if (delta.error) {
        throw new ChatRouteError(502, "MODEL_STREAM_FAILED", delta.error);
      }
      if (delta.done) streamDone = true;
      if (delta.usage) streamMeta.usage = delta.usage;
      if (delta.model) streamMeta.model = delta.model;
      if (delta.text) {
        responseText += delta.text;
        await publishLive(false);
      }
    }

    // Read with an IDLE timeout, not a total one: a reply may take
    // minutes on a slow free model as long as tokens keep arriving,
    // but a stream that goes silent for 50 seconds is dead. If it
    // dies after producing text, the partial reply is kept as the
    // answer instead of an error — a long answer that stops early
    // beats no answer at all.
    const STREAM_IDLE_TIMEOUT_MS = 50_000;
    let idleTimedOut = false;
    async function readWithIdleTimeout() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("STREAM_IDLE_TIMEOUT")),
              STREAM_IDLE_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    while (true) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await readWithIdleTimeout();
      } catch (error) {
        if (error instanceof Error && error.message === "STREAM_IDLE_TIMEOUT") {
          idleTimedOut = true;
          await reader.cancel().catch(() => undefined);
          break;
        }
        throw error;
      }
      const { done, value } = chunk;
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) await handleLine(line.trimEnd());
      if (done) break;
    }
    if (buffer) await handleLine(buffer.trimEnd());
    if (request.signal.aborted) {
      throw new ChatRouteError(499, "RESPONSE_STOPPED", "Response stopped.");
    }
    if ((!streamDone && !idleTimedOut) || !responseText.trim()) {
      throw new ChatRouteError(502, "EMPTY_MODEL_RESPONSE", "The model ended before returning a response. Please try again.");
    }

    await publishLive(true);
    const completedAt = Timestamp.now();
    const finalSearchText = `${searchText}\n${responseText}`.slice(-5000);
    await Promise.all([
      assistantRef.update({
        content: responseText,
        status: "complete",
        updatedAt: completedAt,
        ...(webSources.length ? { sources: webSources } : {}),
      }),
      chatRef.update({
        searchText: finalSearchText,
        lastMessagePreview: responseText.slice(0, 300),
        updatedAt: completedAt,
      }),
    ]);
    assistantSaved = true;
    // Budget accounting for the completed turn (estimate model in
    // lib/server/budget.ts): the batch (user message + assistant
    // placeholder + chat update = 3 writes) plus the two final
    // updates, and the reads spent loading the chat, history and
    // attachments.
    await recordBudget({
      firestoreWrites: regenerate ? 6 : 5,
      firestoreReads: 2 + history.length + attachmentIds.length,
      redisCommands: 4,
    });
    // Meter the turn (admin analytics + the user's own chat usage):
    // real streamed usage when the model reported it, otherwise a
    // ~4 chars/token estimate flagged as estimated.
    const meteredPromptTokens =
      streamMeta.usage?.promptTokens ??
      prepared.messages.reduce((sum, message) => {
        const content: unknown = message.content;
        if (typeof content === "string") {
          return sum + Math.ceil(content.length / 4);
        }
        if (Array.isArray(content)) {
          return (
            sum +
            content.reduce((inner, part) => {
              if (typeof part === "object" && part !== null && "type" in part) {
                if (part.type === "text" && "text" in part && typeof part.text === "string") {
                  return inner + Math.ceil(part.text.length / 4);
                }
                if (part.type === "image_url") return inner + 1024;
              }
              return inner;
            }, 0)
          );
        }
        return sum;
      }, 0);
    const meteredCompletionTokens =
      streamMeta.usage?.completionTokens ?? Math.ceil(responseText.length / 4);
    await recordUsageEvent({
      uid: auth.uid,
      surface: "chat",
      model: streamMeta.model ?? effectiveModel,
      promptTokens: meteredPromptTokens,
      completionTokens: meteredCompletionTokens,
      chatId,
      tokensEstimated: !streamMeta.usage,
    });
    return NextResponse.json(
      { success: true, responseId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (assistantCreated && !assistantSaved) {
      try {
        if (responseText) {
          await assistantRef.update({
            content: responseText,
            status: request.signal.aborted ? "stopped" : "failed",
            updatedAt: Timestamp.now(),
          });
        } else {
          await assistantRef.delete();
        }
      } catch (persistError) {
        console.error("Couldn’t save the interrupted assistant response.", persistError);
      }
    }
    if (error instanceof ChatRouteError) {
      if (error.status === 499) {
        return errorResponse(499, error.code, error.message);
      }
      return errorResponse(error.status, error.code, error.message, error.headers);
    }
    if (request.signal.aborted) {
      return errorResponse(499, "RESPONSE_STOPPED", "Response stopped.");
    }
    console.error("Chat request failed.", error);
    return errorResponse(503, "CHAT_REQUEST_FAILED", "The response couldn’t be completed or saved. Please try again.");
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (locked) {
      try {
        await streamRef.remove();
      } catch (error) {
        console.error("Couldn’t clear the completed Realtime Database response.", error);
      }
    }
  }
}

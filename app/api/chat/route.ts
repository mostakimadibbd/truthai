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

export const runtime = "nodejs";
export const maxDuration = 60;

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

function parseDelta(line: string): { text?: string; done?: boolean; error?: string } {
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
  if (!("choices" in event) || !Array.isArray(event.choices)) return {};
  const choice = event.choices[0];
  if (
    typeof choice !== "object" ||
    choice === null ||
    !("delta" in choice) ||
    typeof choice.delta !== "object" ||
    choice.delta === null ||
    !("content" in choice.delta)
  ) {
    return {};
  }
  if (typeof choice.delta.content === "string") return { text: choice.delta.content };
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
    return { text };
  }
  return {};
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
  let locked = false;
  let assistantCreated = false;
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

    // Ordered attempts: the chosen model first, then Auto (Free), with
    // exactly one retry when the first attempt answers 429/5xx.
    const attempts = modelAttemptOrder(effectiveModel);
    let upstream: Response | null = null;
    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      let candidate: Response;
      try {
        candidate = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": request.nextUrl.origin,
            "X-Title": "Xyro AI",
          },
          body: JSON.stringify({
            model: attempts[attemptIndex],
            messages: prepared.messages,
            stream: true,
            max_tokens: 2048,
          }),
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
          cache: "no-store",
        });
      } catch {
        if (request.signal.aborted) {
          throw new ChatRouteError(499, "RESPONSE_STOPPED", "Response stopped.");
        }
        throw new ChatRouteError(502, "MODEL_UNAVAILABLE", "The free model service is temporarily unavailable.");
      }

      if (candidate.ok && candidate.body) {
        upstream = candidate;
        break;
      }

      const retryable = candidate.status === 429 || candidate.status >= 500;
      const retryAfter = candidate.headers.get("retry-after");
      await candidate.body?.cancel();
      if (retryable && attemptIndex < attempts.length - 1) {
        continue;
      }
      const status = candidate.status === 429 ? 429 : candidate.status >= 500 ? 503 : 502;
      throw new ChatRouteError(
        status,
        status === 429 ? "MODEL_BUSY" : "MODEL_REQUEST_FAILED",
        status === 429
          ? "Free models are busy right now. Please wait a moment and try again."
          : "The model couldn’t process this request. Try again or remove an attachment.",
        retryAfter ? { "Retry-After": retryAfter } : undefined,
      );
    }

    if (!upstream || !upstream.ok || !upstream.body) {
      throw new ChatRouteError(502, "MODEL_UNAVAILABLE", "The free model service is temporarily unavailable.");
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastPublishedAt = 0;
    let streamDone = false;
    // Monotonically increasing sequence number for every published
    // chunk (Phase 5 streaming hardening). The client renders only
    // chunks whose responseId matches its in-flight request and whose
    // seq is newer than the last one it applied, so duplicated,
    // reordered or stale Realtime Database events can never rewind or
    // corrupt the visible reply.
    let streamSeq = 0;
    async function publishLive(force: boolean) {
      const currentTime = Date.now();
      if (!force && currentTime - lastPublishedAt < LIVE_UPDATE_INTERVAL_MS) return;
      streamSeq += 1;
      await streamRef.set({
        responseId,
        messageId: assistantMessageId,
        status: "generating",
        text: responseText,
        seq: streamSeq,
        updatedAt: currentTime,
      });
      lastPublishedAt = currentTime;
    }
    async function handleLine(line: string) {
      const delta = parseDelta(line);
      if (delta.error) {
        throw new ChatRouteError(502, "MODEL_STREAM_FAILED", delta.error);
      }
      if (delta.done) streamDone = true;
      if (delta.text) {
        responseText += delta.text;
        await publishLive(false);
      }
    }

    while (true) {
      const { done, value } = await reader.read();
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
    if (!streamDone || !responseText.trim()) {
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
    if (locked) {
      try {
        await streamRef.remove();
      } catch (error) {
        console.error("Couldn’t clear the completed Realtime Database response.", error);
      }
    }
  }
}

import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import {
  buildOpenRouterMessages,
  type StoredChatMessage,
} from "@/lib/server/chat-attachments";
import {
  getFirebaseAdminDatabase,
  getFirebaseAdminFirestore,
} from "@/lib/server/firebase-admin";
import { authenticateVerifiedUser } from "@/lib/server/request-auth";
import { checkRateLimit } from "@/lib/server/rate-limit";
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
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "This request origin isn’t allowed.");
  }
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
  let userMessageSaved = false;
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
    let history = historySnapshot.docs.flatMap((snapshot) => {
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
        const lastSnapshot = historySnapshot.docs.at(-1);
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
        updatedAt: now,
      };
    });
    if (!transaction.committed) {
      throw new ChatRouteError(409, "RESPONSE_IN_PROGRESS", "A response is already being generated in this chat.");
    }
    locked = true;

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
        createdAt: Timestamp.now(),
      });
      userMessageSaved = true;
    }
    batch.create(assistantRef, {
      role: "assistant",
      content: "",
      attachmentIds: [],
      attachments: [],
      status: "generating",
      inReplyTo: userMessageId,
      createdAt: Timestamp.now(),
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
    userMessageSaved = !regenerate;
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

    let upstream: Response;
    try {
      upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": request.nextUrl.origin,
          "X-Title": "Xyro AI",
        },
        body: JSON.stringify({
          model: "openrouter/free",
          messages: prepared.messages,
          ...(prepared.includesPdf
            ? { plugins: [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }] }
            : {}),
          stream: true,
          max_tokens: 2048,
        }).replace(
          /"plugins":\[\{"id":"file-parser","pdf":\{"engine":"cloudflare-ai"\}\}\]/,
          '"plugins":[{"id":"file-parser","pdf":{"engine":"cloudflare-ai"}}]',
        ),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
        cache: "no-store",
      });
    } catch {
      if (request.signal.aborted) {
        throw new ChatRouteError(499, "RESPONSE_STOPPED", "Response stopped.");
      }
      throw new ChatRouteError(502, "MODEL_UNAVAILABLE", "The free model service is temporarily unavailable.");
    }

    if (!upstream.ok || !upstream.body) {
      const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 503 : 502;
      const retryAfter = upstream.headers.get("retry-after");
      await upstream.body?.cancel();
      throw new ChatRouteError(
        status,
        status === 429 ? "MODEL_BUSY" : "MODEL_REQUEST_FAILED",
        status === 429
          ? "Free models are busy right now. Please wait a moment and try again."
          : "The model couldn’t process this request. Try again or remove an attachment.",
        retryAfter ? { "Retry-After": retryAfter } : undefined,
      );
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastPublishedAt = 0;
    let streamDone = false;
    async function publishLive(force: boolean) {
      const currentTime = Date.now();
      if (!force && currentTime - lastPublishedAt < LIVE_UPDATE_INTERVAL_MS) return;
      await streamRef.set({
        responseId,
        messageId: assistantMessageId,
        status: "generating",
        text: responseText,
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
    return NextResponse.json(
      { success: true, responseId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (assistantRef && assistantCreated && !assistantSaved) {
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

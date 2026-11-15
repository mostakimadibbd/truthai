import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { guardMutationHeaders } from "@/lib/server/auth-guard";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";
import { limitDeniedResponse, limit as rateLimit } from "@/lib/server/limit";
import { authenticateVerifiedUser } from "@/lib/server/request-auth";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 1_000_000;
const MAX_CHATS = 20;
const MAX_MESSAGES_PER_CHAT = 30;
const MAX_MESSAGE_LENGTH = 12_000;
const MAX_CHAT_TEXT = 100_000;
const CHAT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LegacyMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type LegacyChat = {
  id: string;
  title: string;
  updatedAt: number;
  messages: LegacyMessage[];
};

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function parseLegacyChats(value: unknown): LegacyChat[] | null {
  if (!Array.isArray(value) || value.length > MAX_CHATS) return null;
  const chats: LegacyChat[] = [];

  for (const item of value) {
    if (
      typeof item !== "object" ||
      item === null ||
      !("id" in item) ||
      typeof item.id !== "string" ||
      !CHAT_ID_PATTERN.test(item.id) ||
      !("title" in item) ||
      typeof item.title !== "string" ||
      item.title.length === 0 ||
      item.title.length > 60 ||
      !("updatedAt" in item) ||
      typeof item.updatedAt !== "number" ||
      !Number.isFinite(item.updatedAt) ||
      !("messages" in item) ||
      !Array.isArray(item.messages) ||
      item.messages.length > MAX_MESSAGES_PER_CHAT
    ) {
      return null;
    }

    const messages: LegacyMessage[] = [];
    let totalLength = 0;
    for (const message of item.messages) {
      if (
        typeof message !== "object" ||
        message === null ||
        !("id" in message) ||
        typeof message.id !== "string" ||
        !CHAT_ID_PATTERN.test(message.id) ||
        !("role" in message) ||
        (message.role !== "user" && message.role !== "assistant") ||
        !("content" in message) ||
        typeof message.content !== "string" ||
        message.content.length > MAX_MESSAGE_LENGTH ||
        !("createdAt" in message) ||
        typeof message.createdAt !== "number" ||
        !Number.isFinite(message.createdAt)
      ) {
        return null;
      }
      totalLength += message.content.length;
      if (totalLength > MAX_CHAT_TEXT) return null;
      messages.push({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      });
    }
    chats.push({
      id: item.id,
      title: item.title,
      updatedAt: item.updatedAt,
      messages,
    });
  }

  return chats;
}

export async function POST(request: NextRequest) {
  const guard = guardMutationHeaders(request);
  if (guard) return guard;

  const auth = await authenticateVerifiedUser(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);

  // Phase 4: a migration writes whole chat histories — at most
  // 3 runs per user per day (fail closed).
  const limitResult = await rateLimit(
    `chats:migrate:user:${auth.uid}`,
    24 * 60 * 60 * 1000,
    3,
    "closed",
  );
  if (!limitResult.allowed) {
    const denied = limitDeniedResponse(limitResult);
    return errorResponse(denied.status, denied.code, denied.message);
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return errorResponse(413, "MIGRATION_TOO_LARGE", "The saved chat history is too large to import.");
    }
    body = JSON.parse(raw);
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "The saved chat history isn’t valid JSON.");
  }

  const rawChats =
    typeof body === "object" && body !== null && "chats" in body
      ? body.chats
      : undefined;
  const chats = parseLegacyChats(rawChats);
  if (!chats) {
    return errorResponse(400, "INVALID_HISTORY", "The saved chat history can’t be imported.");
  }

  try {
    const db = getFirebaseAdminFirestore();
    const chatsRef = db.collection("users").doc(auth.uid).collection("chats");
    let migrated = 0;

    for (const chat of chats) {
      const chatRef = chatsRef.doc(chat.id);
      if ((await chatRef.get()).exists) continue;

      const messageBatch = db.batch();
      for (const message of chat.messages) {
        messageBatch.create(chatRef.collection("messages").doc(message.id), {
          role: message.role,
          content: message.content,
          attachments: [],
          attachmentIds: [],
          status: "complete",
          createdAt: Timestamp.fromMillis(message.createdAt),
        });
      }
      messageBatch.create(chatRef, {
        title: chat.title,
        searchText: chat.messages.map((message) => message.content).join("\n").slice(-5000),
        createdAt: Timestamp.fromMillis(
          Math.min(...chat.messages.map((message) => message.createdAt), chat.updatedAt),
        ),
        updatedAt: Timestamp.fromMillis(chat.updatedAt),
        migrationSource: "local-storage-v1",
      });
      await messageBatch.commit();
      migrated += 1;
    }

    return NextResponse.json(
      { migrated },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Couldn’t migrate local chat history to Firestore.", error);
    return errorResponse(503, "CHAT_MIGRATION_FAILED", "Chat history couldn’t be moved to Firestore. Your local copy is unchanged.");
  }
}

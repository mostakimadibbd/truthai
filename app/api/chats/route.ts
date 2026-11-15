import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { guardMutationHeaders } from "@/lib/server/auth-guard";
import { recordBudget } from "@/lib/server/budget";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";
import { limitDeniedResponse, limit as rateLimit } from "@/lib/server/limit";
import { authenticateVerifiedUser } from "@/lib/server/request-auth";

export const runtime = "nodejs";

const CHAT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const guard = guardMutationHeaders(request);
  if (guard) return guard;

  const auth = await authenticateVerifiedUser(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);

  // Phase 4: creating chats is a Firestore write path — cap it at
  // 30 new chats per user per day (fail closed).
  const limitResult = await rateLimit(
    `chats:create:user:${auth.uid}`,
    24 * 60 * 60 * 1000,
    30,
    "closed",
  );
  if (!limitResult.allowed) {
    const denied = limitDeniedResponse(limitResult);
    return errorResponse(denied.status, denied.code, denied.message);
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 4096) {
      return errorResponse(400, "INVALID_REQUEST", "The chat request is too large.");
    }
    body = JSON.parse(raw);
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "The chat request isn’t valid JSON.");
  }

  const chatId =
    typeof body === "object" && body !== null && "chatId" in body
      ? body.chatId
      : undefined;
  if (typeof chatId !== "string" || !CHAT_ID_PATTERN.test(chatId)) {
    return errorResponse(400, "INVALID_CHAT_ID", "The conversation ID isn’t valid.");
  }

  try {
    const chatRef = getFirebaseAdminFirestore()
      .collection("users")
      .doc(auth.uid)
      .collection("chats")
      .doc(chatId);
    const snapshot = await chatRef.get();
    if (!snapshot.exists) {
      const now = Timestamp.now();
      await chatRef.create({
        title: "New chat",
        searchText: "",
        createdAt: now,
        updatedAt: now,
      });
      await recordBudget({ firestoreWrites: 1, firestoreReads: 1, redisCommands: 4 });
    }
    return NextResponse.json(
      { chatId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Couldn’t create the Firestore chat.", error);
    return errorResponse(503, "CHAT_STORAGE_UNAVAILABLE", "Chat history is temporarily unavailable.");
  }
}

import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";
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
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "This request origin isn’t allowed.");
  }

  const auth = await authenticateVerifiedUser(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);

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

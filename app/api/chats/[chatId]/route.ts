import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import {
  deleteCloudinaryResource,
  type CloudinaryResourceType,
} from "@/lib/server/cloudinary";
import {
  getFirebaseAdminDatabase,
  getFirebaseAdminFirestore,
} from "@/lib/server/firebase-admin";
import { authenticateVerifiedUser } from "@/lib/server/request-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

const CHAT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ chatId: string }> };

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function isCloudinaryResourceType(value: unknown): value is CloudinaryResourceType {
  return value === "image" || value === "raw";
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "This request origin isn’t allowed.");
  }
  const auth = await authenticateVerifiedUser(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);

  const { chatId } = await context.params;
  if (!CHAT_ID_PATTERN.test(chatId)) {
    return errorResponse(400, "INVALID_CHAT_ID", "The conversation ID isn’t valid.");
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

  const title =
    typeof body === "object" && body !== null && "title" in body && typeof body.title === "string"
      ? body.title.trim()
      : "";
  if (!title || title.length > 60) {
    return errorResponse(400, "INVALID_TITLE", "Chat names must be 1 to 60 characters.");
  }

  try {
    const chatRef = getFirebaseAdminFirestore()
      .collection("users")
      .doc(auth.uid)
      .collection("chats")
      .doc(chatId);
    const chatSnapshot = await chatRef.get();
    if (!chatSnapshot.exists) {
      return errorResponse(404, "CHAT_NOT_FOUND", "This conversation no longer exists.");
    }
    await chatRef.update({ title, updatedAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Couldn’t rename the Firestore chat.", error);
    return errorResponse(503, "CHAT_STORAGE_UNAVAILABLE", "Chat history is temporarily unavailable.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "This request origin isn’t allowed.");
  }
  const auth = await authenticateVerifiedUser(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);

  const { chatId } = await context.params;
  if (!CHAT_ID_PATTERN.test(chatId)) {
    return errorResponse(400, "INVALID_CHAT_ID", "The conversation ID isn’t valid.");
  }

  try {
    const db = getFirebaseAdminFirestore();
    const userRef = db.collection("users").doc(auth.uid);
    const chatRef = userRef.collection("chats").doc(chatId);
    if (!(await chatRef.get()).exists) {
      return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
    }

    const uploads = await userRef.collection("uploads")
      .where("chatId", "==", chatId)
      .get();
    const assets = uploads.docs.map((snapshot) => snapshot.data());
    for (let index = 0; index < assets.length; index += 5) {
      const results = await Promise.all(
        assets.slice(index, index + 5).map(async (asset) => {
          if (
            typeof asset.publicId !== "string" ||
            !isCloudinaryResourceType(asset.resourceType)
          ) {
            throw new Error("The chat contains invalid Cloudinary asset metadata.");
          }
          return deleteCloudinaryResource(asset.publicId, asset.resourceType);
        }),
      );
      if (results.some((result) => result.result !== "ok" && result.result !== "not found")) {
        throw new Error("Cloudinary did not confirm deletion of every chat attachment.");
      }
    }

    await getFirebaseAdminDatabase().ref(`chatStreams/${auth.uid}/${chatId}`).remove();

    const messagesRef = chatRef.collection("messages");
    let lastDocument: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    while (true) {
      let query = messagesRef.orderBy("__name__").limit(400);
      if (lastDocument) query = query.startAfter(lastDocument);
      const page = await query.get();
      if (page.empty) break;
      const batch = db.batch();
      page.docs.forEach((snapshot) => batch.delete(snapshot.ref));
      await batch.commit();
      lastDocument = page.docs.at(-1);
      if (page.size < 400) break;
    }

    for (let index = 0; index < uploads.docs.length; index += 400) {
      const batch = db.batch();
      uploads.docs.slice(index, index + 400).forEach((snapshot) => batch.delete(snapshot.ref));
      await batch.commit();
    }
    await chatRef.delete();
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Couldn’t fully delete the Firestore chat and its Cloudinary assets.", error);
    return errorResponse(503, "CHAT_DELETE_FAILED", "The conversation or its files couldn’t be fully deleted. Please retry.");
  }
}

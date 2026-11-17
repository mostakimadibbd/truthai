import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { guardMutationHeaders } from "@/lib/server/auth-guard";
import { createCloudinaryUploadSignature } from "@/lib/server/cloudinary";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";
import { authenticateVerifiedUser } from "@/lib/server/request-auth";
import { checkRateLimit } from "@/lib/server/rate-limit";
import {
  MAX_ATTACHMENTS_PER_CHAT,
  MAX_UPLOAD_BYTES,
  getUploadSpec,
  sanitizeUploadName,
} from "@/lib/server/upload-policy";

export const runtime = "nodejs";

const CHAT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  // Phase 4: a missing Origin is now rejected here too (previously
  // any request without one was let through), and the
  // X-Requested-With header is required like every other mutation.
  const guard = guardMutationHeaders(request);
  if (guard) return guard;
  const auth = await authenticateVerifiedUser(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);

  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  const contentLength = Number(request.headers.get("content-length"));
  if (
    contentType !== "application/json" ||
    (Number.isFinite(contentLength) && contentLength > 4096)
  ) {
    return errorResponse(400, "INVALID_REQUEST", "The upload request isn’t valid.");
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 4096) {
      return errorResponse(400, "INVALID_REQUEST", "The upload request is too large.");
    }
    body = JSON.parse(raw);
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "The upload request isn’t valid JSON.");
  }

  const chatId =
    typeof body === "object" && body !== null && "chatId" in body
      ? body.chatId
      : undefined;
  const name =
    typeof body === "object" && body !== null && "name" in body && typeof body.name === "string"
      ? sanitizeUploadName(body.name)
      : "";
  const mimeType =
    typeof body === "object" && body !== null && "mimeType" in body && typeof body.mimeType === "string"
      ? body.mimeType
      : "";
  const size =
    typeof body === "object" && body !== null && "size" in body
      ? body.size
      : undefined;
  const spec = getUploadSpec(name, mimeType);
  if (
    typeof chatId !== "string" ||
    !CHAT_ID_PATTERN.test(chatId) ||
    !name ||
    !spec ||
    typeof size !== "number" ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > MAX_UPLOAD_BYTES
  ) {
    return errorResponse(
      400,
      "INVALID_UPLOAD",
      "Use an image, PDF, TXT, Markdown, or CSV file no larger than 10 MB.",
    );
  }

  const rateLimit = await checkRateLimit(auth.uid, "upload", 5, 20);
  if (rateLimit.state === "unavailable") {
    return errorResponse(503, "UPLOAD_GUARD_UNAVAILABLE", "Uploads are temporarily unavailable.");
  }
  if (rateLimit.state === "limited") {
    return errorResponse(429, "UPLOAD_RATE_LIMITED", "You’ve reached the upload limit. Please wait before uploading again.");
  }

  try {
    const db = getFirebaseAdminFirestore();
    const userRef = db.collection("users").doc(auth.uid);
    const chatRef = userRef.collection("chats").doc(chatId);
    if (!(await chatRef.get()).exists) {
      return errorResponse(404, "CHAT_NOT_FOUND", "Create a chat before uploading files.");
    }

    const existingUploads = await userRef.collection("uploads")
      .where("chatId", "==", chatId)
      .limit(MAX_ATTACHMENTS_PER_CHAT)
      .get();
    if (existingUploads.size >= MAX_ATTACHMENTS_PER_CHAT) {
      return errorResponse(413, "CHAT_UPLOAD_LIMIT", "This chat has reached its attachment limit.");
    }

    const assetId = randomUUID();
    const publicId =
      `xyro_${auth.uid}_${chatId}_${assetId}` +
      (spec.resourceType === "raw" ? `.${spec.format}` : "");
    const timestamp = Math.floor(Date.now() / 1000);
    // NOTE: `overwrite` is deliberately NOT signed or sent.
    // Public ids are UUID-unique, so overwrite protection is
    // moot — and a signed boolean false is the most fragile
    // parameter in Cloudinary signature verification (its
    // server-side serialization of false has historically
    // differed from the SDK's, producing "Invalid signature"
    // rejections on otherwise-correct uploads).
    const signed = createCloudinaryUploadSignature({
      timestamp,
      public_id: publicId,
      type: "authenticated",
    });

    await userRef.collection("uploads").doc(assetId).create({
      assetId,
      chatId,
      name,
      mimeType: spec.mimeType,
      expectedBytes: size,
      format: spec.format,
      resourceType: spec.resourceType,
      publicId,
      deliveryType: "authenticated",
      status: "pending",
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
    });

    return NextResponse.json(
      {
        assetId,
        cloudName: signed.cloudName,
        apiKey: signed.apiKey,
        uploadPreset: signed.uploadPreset,
        signature: signed.signature,
        timestamp,
        publicId,
        resourceType: spec.resourceType,
        deliveryType: "authenticated",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Couldn’t create a Cloudinary upload signature.", error);
    return errorResponse(503, "UPLOAD_NOT_CONFIGURED", "Private file uploads aren’t configured for this deployment.");
  }
}

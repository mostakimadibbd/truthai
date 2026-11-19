import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { guardMutationHeaders } from "@/lib/server/auth-guard";
import {
  ownFileAccessUrl,
  uploadUserFile, cloudinaryErrorMessage } from "@/lib/server/cloudinary";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";
import { validateUploadContent } from "@/lib/server/image-sniff";
import { authenticateVerifiedUser } from "@/lib/server/request-auth";
import { checkRateLimit } from "@/lib/server/rate-limit";
import {
  MAX_ATTACHMENTS_PER_CHAT,
  getUploadSpec,
  sanitizeUploadName,
} from "@/lib/server/upload-policy";

export const runtime = "nodejs";
// The file transits this function, so the response can take a
// few seconds on slow uplinks.
export const maxDuration = 60;

const CHAT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Server-mediated upload fallback. The browser's primary path
 * uploads directly to Cloudinary with a signed preset; when
 * Cloudinary rejects that (preset or signature trouble), the
 * client retries small files through here and the server
 * uploads with the account secret via the SDK — the same
 * proven path generated images and avatars use. Capped at
 * 4 MB because platform request-body limits sit below the
 * 10 MB direct-upload cap.
 */
const DIRECT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "The upload request isn’t valid.");
  }
  const chatId = form.get("chatId");
  const file = form.get("file");
  if (
    typeof chatId !== "string" ||
    !CHAT_ID_PATTERN.test(chatId) ||
    !(file instanceof File)
  ) {
    return errorResponse(
      400,
      "INVALID_UPLOAD",
      "Use an image, PDF, TXT, Markdown, or CSV file no larger than 10 MB.",
    );
  }
  const name = sanitizeUploadName(file.name);
  const spec = getUploadSpec(name, file.type);
  if (!name || !spec || file.size < 1 || file.size > DIRECT_UPLOAD_MAX_BYTES) {
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
    const buffer = Buffer.from(await file.arrayBuffer());
    // Same content honesty check the confirm route applies:
    // the bytes must match the declared format before anything
    // is stored.
    const content = validateUploadContent(buffer, spec.format);
    if (!content.ok) {
      return errorResponse(
        415,
        "CONTENT_TYPE_MISMATCH",
        "The file’s contents don’t match its type. Upload the file in its real format.",
      );
    }

    const db = getFirebaseAdminFirestore();
    const userRef = db.collection("users").doc(auth.uid);
    const chatRef = userRef.collection("chats").doc(chatId);
    if (!(await chatRef.get()).exists) {
      return errorResponse(404, "CHAT_NOT_FOUND", "Create a chat before uploading files.");
    }
    const existingUploads = await userRef
      .collection("uploads")
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
    const uploaded = await uploadUserFile(buffer, {
      publicId,
      resourceType: spec.resourceType,
      format: spec.format,
    });
    if (uploaded.bytes !== file.size) {
      return errorResponse(400, "UPLOAD_VALIDATION_FAILED", "Cloudinary couldn’t verify the file type or size.");
    }

    await userRef.collection("uploads").doc(assetId).create({
      assetId,
      chatId,
      name,
      mimeType: spec.mimeType,
      expectedBytes: file.size,
      bytes: uploaded.bytes,
      format: spec.format,
      resourceType: spec.resourceType,
      // The id Cloudinary actually recorded (echoes the
      // requested id; stored from the response so the record
      // always matches the asset).
      publicId: uploaded.publicId,
      deliveryType: "authenticated",
      status: "ready",
      createdAt: Timestamp.now(),
      confirmedAt: Timestamp.now(),
    });

    return NextResponse.json(
      {
        attachment: {
          id: assetId,
          name,
          mimeType: spec.mimeType,
          size: uploaded.bytes,
          accessUrl: ownFileAccessUrl(uploaded.publicId, assetId),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Couldn’t complete the server-mediated upload.", error);
    return errorResponse(503, "UPLOAD_FAILED", `The file couldn’t be uploaded. (${cloudinaryErrorMessage(error)})`);
  }
}

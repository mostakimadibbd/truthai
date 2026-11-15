import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  guardAuthPost,
  stringField,
} from "@/lib/server/auth-guard";
import { authenticateSessionUser } from "@/lib/server/api-auth";
import {
  checkWindowLimit,
  rateLimitedResponse,
} from "@/lib/server/auth-rate-limit";
import { uploadAvatarImage } from "@/lib/server/cloudinary";
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";
import { IMAGE_MIME_BY_SNIFF, sniffImageType } from "@/lib/server/image-sniff";

export const runtime = "nodejs";
export const maxDuration = 30;

// 2 MB image → ~2.8 MB of base64 plus JSON overhead.
const MAX_BODY_BYTES = 3_800_000;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

// Avatar upload. The client crops to a 256×256 square (canvas) and
// sends base64 JSON through the standard guard; the server re-checks
// everything that matters: decoded size ≤ 2 MB, the declared type is
// an image type, and the magic bytes agree. The image is stored in
// Cloudinary (type "upload", xyro/avatars/{uid}) and the URL is saved
// to both the Firestore profile and the Firebase Auth photoURL, which
// is what the header and sidebar render.
export async function POST(request: NextRequest) {
  const guarded = await guardAuthPost(request, MAX_BODY_BYTES);
  if (!guarded.ok) return guarded.response;

  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }

  // Phase 4 audit addition: avatar uploads spend Cloudinary credits
  // — cap at 20 per user per hour (fail closed).
  const avatarLimit = await checkWindowLimit(
    `xyro:settings:avatar:user:${auth.uid}`,
    60 * 60 * 1000,
    20,
  );
  if (avatarLimit.state !== "allowed") {
    const limited = rateLimitedResponse(avatarLimit);
    return authErrorResponse(limited.status, limited.code, limited.message, {
      ...(limited.retryAfter
        ? { "Retry-After": String(limited.retryAfter) }
        : {}),
    });
  }

  const dataBase64 = stringField(guarded.body, "dataBase64") ?? "";
  const declaredType = stringField(guarded.body, "contentType") ?? "";
  if (!dataBase64 || dataBase64.length > Math.ceil(MAX_AVATAR_BYTES * 1.4)) {
    return authErrorResponse(400, "INVALID_AVATAR", "Choose an image up to 2 MB.");
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(dataBase64, "base64");
  } catch {
    return authErrorResponse(400, "INVALID_AVATAR", "That file couldn’t be read as an image.");
  }
  if (buffer.length === 0 || buffer.length > MAX_AVATAR_BYTES) {
    return authErrorResponse(400, "AVATAR_TOO_LARGE", "Choose an image up to 2 MB.");
  }

  const sniffed = sniffImageType(buffer);
  if (!sniffed || IMAGE_MIME_BY_SNIFF[sniffed] !== declaredType) {
    return authErrorResponse(
      400,
      "INVALID_AVATAR_TYPE",
      "Avatars must be PNG, JPEG, WebP or GIF images.",
    );
  }

  try {
    const { url } = await uploadAvatarImage(buffer, auth.uid);
    const adminAuth = getFirebaseAdminAuth();
    await adminAuth.updateUser(auth.uid, { photoURL: url });
    await getFirebaseAdminFirestore()
      .collection("users")
      .doc(auth.uid)
      .set(
        { photoURL: url, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    return NextResponse.json(
      { photoURL: url },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Avatar upload failed.", error);
    return authErrorResponse(
      503,
      "AVATAR_UPLOAD_FAILED",
      "Your picture couldn’t be saved right now. Please try again.",
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  deleteCloudinaryResource,
  type CloudinaryResourceType,
} from "@/lib/server/cloudinary";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";
import { authenticateVerifiedUser } from "@/lib/server/request-auth";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type RouteContext = { params: Promise<{ assetId: string }> };

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "This request origin isn’t allowed.");
  }
  const auth = await authenticateVerifiedUser(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);

  const { assetId } = await context.params;
  if (!UUID_PATTERN.test(assetId)) {
    return errorResponse(400, "INVALID_ASSET_ID", "The file ID isn’t valid.");
  }

  try {
    const db = getFirebaseAdminFirestore();
    const userRef = db.collection("users").doc(auth.uid);
    const uploadRef = userRef.collection("uploads").doc(assetId);
    const uploadSnapshot = await uploadRef.get();
    if (!uploadSnapshot.exists) {
      return new NextResponse(null, { status: 204 });
    }
    const upload = uploadSnapshot.data();
    if (!upload || typeof upload.chatId !== "string") {
      return errorResponse(500, "UPLOAD_METADATA_INVALID", "The file metadata couldn’t be verified.");
    }

    const attached = await userRef
      .collection("chats")
      .doc(upload.chatId)
      .collection("messages")
      .where("attachmentIds", "array-contains", assetId)
      .limit(1)
      .get();
    if (!attached.empty) {
      return errorResponse(409, "FILE_ALREADY_ATTACHED", "Remove this file from its message before deleting it.");
    }

    if (
      typeof upload.publicId === "string" &&
      (upload.resourceType === "image" || upload.resourceType === "raw")
    ) {
      const result = await deleteCloudinaryResource(
        upload.publicId,
        upload.resourceType as CloudinaryResourceType,
      );
      if (result.result !== "ok" && result.result !== "not found") {
        return errorResponse(503, "FILE_DELETE_FAILED", "Cloudinary couldn’t delete this file. Please retry.");
      }
    }
    await uploadRef.delete();
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Couldn’t delete a Cloudinary upload.", error);
    return errorResponse(503, "FILE_DELETE_FAILED", "This file couldn’t be deleted. Please retry.");
  }
}

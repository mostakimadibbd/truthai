import { NextRequest, NextResponse } from "next/server";
import {
  getCloudinaryPrivateDownloadUrl,
  type CloudinaryResourceType,
} from "@/lib/server/cloudinary";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";
import { authenticateVerifiedUser } from "@/lib/server/request-auth";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  const auth = await authenticateVerifiedUser(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);

  const assetId = request.nextUrl.searchParams.get("assetId");
  if (!assetId || !UUID_PATTERN.test(assetId)) {
    return errorResponse(400, "INVALID_ASSET_ID", "The file ID isn’t valid.");
  }

  try {
    const upload = await getFirebaseAdminFirestore()
      .collection("users")
      .doc(auth.uid)
      .collection("uploads")
      .doc(assetId)
      .get();
    const data = upload.data();
    if (
      !data ||
      data.status !== "ready" ||
      typeof data.publicId !== "string" ||
      typeof data.format !== "string" ||
      (data.resourceType !== "image" && data.resourceType !== "raw")
    ) {
      return errorResponse(404, "FILE_NOT_FOUND", "This file is unavailable.");
    }

    return NextResponse.json(
      {
        accessUrl: getCloudinaryPrivateDownloadUrl(
          data.publicId,
          data.format,
          data.resourceType as CloudinaryResourceType,
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Couldn’t create a temporary Cloudinary file link.", error);
    return errorResponse(503, "FILE_ACCESS_UNAVAILABLE", "This file is temporarily unavailable.");
  }
}

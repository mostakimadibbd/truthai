import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import {
  getCloudinaryPrivateDownloadUrl,
  getCloudinaryResource,
  type CloudinaryResourceType,
} from "@/lib/server/cloudinary";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";
import { authenticateVerifiedUser } from "@/lib/server/request-auth";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function getValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? value[key as keyof typeof value]
    : undefined;
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
      return errorResponse(400, "INVALID_REQUEST", "The upload request is too large.");
    }
    body = JSON.parse(raw);
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "The upload request isn’t valid JSON.");
  }

  const assetId = getValue(body, "assetId");
  if (typeof assetId !== "string" || !UUID_PATTERN.test(assetId)) {
    return errorResponse(400, "INVALID_ASSET_ID", "The uploaded file ID isn’t valid.");
  }

  try {
    const db = getFirebaseAdminFirestore();
    const uploadRef = db.collection("users").doc(auth.uid).collection("uploads").doc(assetId);
    const uploadSnapshot = await uploadRef.get();
    if (!uploadSnapshot.exists) {
      return errorResponse(404, "UPLOAD_NOT_FOUND", "The upload request has expired or doesn’t exist.");
    }
    const upload = uploadSnapshot.data();
    if (
      !upload ||
      typeof upload.publicId !== "string" ||
      (upload.resourceType !== "image" && upload.resourceType !== "raw") ||
      typeof upload.format !== "string" ||
      typeof upload.name !== "string" ||
      typeof upload.mimeType !== "string"
    ) {
      return errorResponse(500, "UPLOAD_METADATA_INVALID", "The upload metadata couldn’t be verified.");
    }

    if (upload.status === "ready") {
      return NextResponse.json(
        {
          attachment: {
            id: assetId,
            name: upload.name,
            mimeType: upload.mimeType,
            size: upload.bytes,
            accessUrl: getCloudinaryPrivateDownloadUrl(
              upload.publicId,
              upload.format,
              upload.resourceType as CloudinaryResourceType,
            ),
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const resource: unknown = await getCloudinaryResource(
      upload.publicId,
      upload.resourceType as CloudinaryResourceType,
    );
    const actualPublicId = getValue(resource, "public_id");
    const actualResourceType = getValue(resource, "resource_type");
    const deliveryType = getValue(resource, "type");
    const format = getValue(resource, "format");
    const bytes = getValue(resource, "bytes");
    if (
      actualPublicId !== upload.publicId ||
      actualResourceType !== upload.resourceType ||
      deliveryType !== "authenticated" ||
      format !== upload.format ||
      typeof bytes !== "number" ||
      bytes !== upload.expectedBytes ||
      bytes < 1 ||
      bytes > MAX_UPLOAD_BYTES
    ) {
      return errorResponse(400, "UPLOAD_VALIDATION_FAILED", "Cloudinary couldn’t verify the file type or size.");
    }

    await uploadRef.update({
      status: "ready",
      bytes,
      confirmedAt: Timestamp.now(),
    });
    const accessUrl = getCloudinaryPrivateDownloadUrl(
      upload.publicId,
      upload.format,
      upload.resourceType as CloudinaryResourceType,
    );
    return NextResponse.json(
      {
        attachment: {
          id: assetId,
          name: upload.name,
          mimeType: upload.mimeType,
          size: bytes,
          accessUrl,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Couldn’t verify the Cloudinary upload.", error);
    return errorResponse(503, "UPLOAD_CONFIRMATION_FAILED", "Cloudinary couldn’t verify the upload. Please try again.");
  }
}

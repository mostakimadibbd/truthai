import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { guardMutationHeaders } from "@/lib/server/auth-guard";
import { recordBudget } from "@/lib/server/budget";
import {
  deleteCloudinaryResource,
  getCloudinaryPrivateDownloadUrl,
  getCloudinaryResource,
  type CloudinaryResourceType,
} from "@/lib/server/cloudinary";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";
import { validateUploadContent } from "@/lib/server/image-sniff";
import { limitDeniedResponse, limit as rateLimit } from "@/lib/server/limit";
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

const TEXT_FORMATS = new Set(["txt", "md", "csv"]);

/**
 * Fetch only the head of a stored file for content validation
 * (Phase 4). Cloudinary's bandwidth is credit-metered, so this
 * never downloads a whole binary file: a Range request asks for the
 * first bytes, and the stream is cancelled as soon as enough bytes
 * have arrived (4 KB covers every magic-byte signature; 64 KB of a
 * text file is enough to prove it is UTF-8 text and not a renamed
 * binary). Returns null when the sample couldn't be fetched.
 */
async function fetchContentSample(
  url: string,
  maxBytes: number,
): Promise<Buffer | null> {
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=0-${maxBytes - 1}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    if (!response.body) {
      const buffer = Buffer.from(await response.arrayBuffer());
      return buffer.subarray(0, maxBytes);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    await reader.cancel().catch(() => undefined);
    return Buffer.concat(chunks).subarray(0, maxBytes);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const guard = guardMutationHeaders(request);
  if (guard) return guard;
  const auth = await authenticateVerifiedUser(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);

  // Phase 4: confirmations capped at 60 per user per hour (fail
  // closed) — each one costs Cloudinary/Firestore work.
  const limitResult = await rateLimit(
    `uploads:confirm:user:${auth.uid}`,
    60 * 60 * 1000,
    60,
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

    // Phase 4 content validation: Cloudinary's metadata only proves
    // what the file CLAIMS to be. Sample the actual bytes (head
    // only — see fetchContentSample) and check magic bytes for
    // jpg/png/webp/gif/pdf, or UTF-8 validity for txt/md/csv.
    const sampleUrl = getCloudinaryPrivateDownloadUrl(
      upload.publicId,
      upload.format,
      upload.resourceType as CloudinaryResourceType,
    );
    const sample = await fetchContentSample(
      sampleUrl,
      TEXT_FORMATS.has(upload.format) ? 64 * 1024 : 4096,
    );
    if (!sample) {
      return errorResponse(503, "UPLOAD_CONFIRMATION_FAILED", "Cloudinary couldn’t verify the upload. Please try again.");
    }
    const content = validateUploadContent(sample, upload.format);
    if (!content.ok) {
      // Mislabeled content: remove the asset and its record so it
      // can never be attached, then tell the user plainly.
      try {
        await deleteCloudinaryResource(
          upload.publicId,
          upload.resourceType as CloudinaryResourceType,
        );
      } catch (deleteError) {
        console.error("Couldn’t delete a content-mismatched Cloudinary asset.", deleteError);
      }
      await uploadRef.delete().catch(() => undefined);
      return errorResponse(
        415,
        "CONTENT_TYPE_MISMATCH",
        "The file’s contents don’t match its type, so it was removed. Upload the file in its real format.",
      );
    }

    await uploadRef.update({
      status: "ready",
      bytes,
      confirmedAt: Timestamp.now(),
    });
    await recordBudget({ firestoreWrites: 1, firestoreReads: 1, redisCommands: 4 });
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

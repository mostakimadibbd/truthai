import { NextRequest, NextResponse } from "next/server";
import { readBlob } from "@/lib/server/blob-store";
import {
  blobIdFromPublicId,
  getCloudinaryPrivateDownloadUrl,
  isBlobPublicId,
  type CloudinaryResourceType,
} from "@/lib/server/cloudinary";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";
import { requireSession } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Streams a private file (chat attachment or generated image)
 * from OUR domain — the only file URL a browser ever sees
 * (owner requirement, 2026-11-19). The browser never receives
 * a Cloudinary link: this route re-checks the session, proves
 * the asset belongs to the signed-in owner via its uploads
 * record, then fetches the bytes server-side from Cloudinary
 * (or the legacy blob store) and streams them back inline.
 * A copied link is useless without the owner's session.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

function notFound() {
  return NextResponse.json(
    { error: { code: "FILE_NOT_FOUND", message: "This file is unavailable." } },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

type RouteContext = { params: Promise<{ assetId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { assetId } = await context.params;
  if (!UUID_PATTERN.test(assetId)) return notFound();

  const session = await requireSession(request);
  if (!session.ok) return notFound();

  const snapshot = await getFirebaseAdminFirestore()
    .collection("users")
    .doc(session.uid)
    .collection("uploads")
    .doc(assetId)
    .get()
    .catch(() => null);
  const data = snapshot?.data();
  if (
    !snapshot?.exists ||
    !data ||
    data.status !== "ready" ||
    typeof data.publicId !== "string" ||
    typeof data.format !== "string" ||
    (data.resourceType !== "image" && data.resourceType !== "raw")
  ) {
    return notFound();
  }

  const format = (data.format as string).toLowerCase();
  const contentType = CONTENT_TYPES[format] ?? "application/octet-stream";
  const fileName =
    typeof data.name === "string" && data.name.length > 0
      ? data.name.replace(/["\r\n]/g, "_")
      : `${assetId}.${format}`;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": `inline; filename="${fileName}"`,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };

  // Legacy blob-store asset: serve its bytes directly.
  if (isBlobPublicId(data.publicId)) {
    const blob = await readBlob(blobIdFromPublicId(data.publicId)).catch(() => null);
    if (!blob) return notFound();
    return new NextResponse(new Uint8Array(blob.buffer), {
      status: 200,
      headers: { ...headers, "Content-Length": String(blob.buffer.length) },
    });
  }

  // Cloudinary-backed asset: fetch server-side (the signed URL
  // is minted here and never leaves the server) and stream the
  // response through, honouring Range so PDF viewers can page.
  const upstreamUrl = getCloudinaryPrivateDownloadUrl(
    data.publicId,
    data.format,
    data.resourceType as CloudinaryResourceType,
  );
  const range = request.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: range ? { Range: range } : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return notFound();
  }
  if (!upstream.ok && upstream.status !== 206) return notFound();
  const length = upstream.headers.get("content-length");
  if (length) headers["Content-Length"] = length;
  else if (typeof data.bytes === "number") {
    headers["Content-Length"] = String(data.bytes);
  }
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers["Content-Range"] = contentRange;
  headers["Accept-Ranges"] = "bytes";
  return new NextResponse(upstream.body, {
    status: upstream.status === 206 ? 206 : 200,
    headers,
  });
}

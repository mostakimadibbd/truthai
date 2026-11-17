import { NextRequest, NextResponse } from "next/server";
import { readBlob, readBlobMeta } from "@/lib/server/blob-store";
import { requireSession } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Serves files from the fallback blob store (see
 * lib/server/blob-store.ts). Access mirrors the Cloudinary
 * delivery types it replaces:
 *
 *  - avatar blobs are public profile pictures: the unguessable
 *    128-bit id is the capability, exactly like a public
 *    Cloudinary URL (the admin panel loads them cross-origin).
 *  - generated and file blobs are private: a valid session for
 *    the OWNING account is required — stricter than the
 *    15-minute signed Cloudinary URLs they replace.
 */

const BLOB_ID_PATTERN = /^[A-Za-z0-9_-]{16,32}$/;

function notFound() {
  return NextResponse.json(
    { error: { code: "FILE_NOT_FOUND", message: "This file is unavailable." } },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ blobId: string }> },
) {
  const { blobId } = await params;
  if (!BLOB_ID_PATTERN.test(blobId)) return notFound();

  const meta = await readBlobMeta(blobId).catch(() => null);
  if (!meta) return notFound();

  if (meta.kind !== "avatar") {
    const session = await requireSession(request);
    if (!session.ok || session.uid !== meta.uid) return notFound();
  }

  const blob = await readBlob(blobId).catch(() => null);
  if (!blob) return notFound();

  return new NextResponse(new Uint8Array(blob.buffer), {
    status: 200,
    headers: {
      "Content-Type": meta.contentType,
      "Content-Length": String(blob.buffer.length),
      "Cache-Control":
        meta.kind === "avatar"
          ? "public, max-age=86400"
          : "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}

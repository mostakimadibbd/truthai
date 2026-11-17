import { randomBytes } from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";

/**
 * Fallback media storage (2026-11-17): chunked blob storage in
 * Firestore. It briefly served as the automatic fallback while
 * the Cloudinary API key lacked the permissions the Admin and
 * upload APIs need (every call 403'd). The owner fixed the key
 * (master permissions) the same day and directed that uploads
 * go ONLY to Cloudinary, so saveBlob has no production callers
 * now. The read/delete paths stay live for any files stored
 * during the outage window (served via /api/media, deleted via
 * the usual cleanup flows), and mediaStats/global still feeds
 * the admin panel's fallback view if Cloudinary ever fails
 * again. Files are split into ≤700 KB chunks (Firestore's
 * per-document limit is ~1 MiB) under mediaBlobs/{id}/chunks.
 *
 * Blob ids are 128-bit random: possession of an id is the
 * capability for avatar-kind blobs (public profile pictures,
 * the same exposure as a public Cloudinary URL); all other
 * kinds additionally require the owner's session at read time.
 */

export const BLOB_CHUNK_BYTES = 700_000;
export const BLOB_QUOTA_BYTES = 1_073_741_824; // ~1 GiB (Firestore Spark)

export type BlobKind = "avatar" | "generated" | "file";

export type BlobMeta = {
  contentType: string;
  size: number;
  chunks: number;
  uid: string;
  kind: BlobKind;
};

/** Split a buffer into storage-sized chunks (pure; tested). */
export function chunkBuffer(buffer: Buffer, size: number = BLOB_CHUNK_BYTES): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += size) {
    chunks.push(buffer.subarray(offset, offset + size));
  }
  return chunks.length > 0 ? chunks : [Buffer.alloc(0)];
}

/** Reassemble chunks in order (pure; tested). */
export function joinChunks(chunks: Buffer[]): Buffer {
  return Buffer.concat(chunks);
}

function newBlobId(): string {
  return randomBytes(16).toString("base64url");
}

export async function saveBlob(
  buffer: Buffer,
  meta: { contentType: string; uid: string; kind: BlobKind },
  db: Firestore = getFirebaseAdminFirestore(),
): Promise<{ blobId: string; bytes: number }> {
  const blobId = newBlobId();
  const chunks = chunkBuffer(buffer);
  const ref = db.collection("mediaBlobs").doc(blobId);
  const batch = db.batch();
  batch.set(ref, {
    contentType: meta.contentType,
    size: buffer.length,
    chunks: chunks.length,
    uid: meta.uid,
    kind: meta.kind,
    ts: Date.now(),
    createdAt: Timestamp.now(),
  });
  chunks.forEach((chunk, index) => {
    batch.set(ref.collection("chunks").doc(String(index)), { data: chunk });
  });
  batch.set(
    db.collection("mediaStats").doc("global"),
    {
      count: FieldValue.increment(1),
      bytes: FieldValue.increment(buffer.length),
    },
    { merge: true },
  );
  await batch.commit();
  return { blobId, bytes: buffer.length };
}

export async function readBlobMeta(
  blobId: string,
  db: Firestore = getFirebaseAdminFirestore(),
): Promise<BlobMeta | null> {
  const snapshot = await db.collection("mediaBlobs").doc(blobId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() ?? {};
  if (
    typeof data.contentType !== "string" ||
    typeof data.size !== "number" ||
    typeof data.chunks !== "number" ||
    typeof data.uid !== "string" ||
    (data.kind !== "avatar" && data.kind !== "generated" && data.kind !== "file")
  ) {
    return null;
  }
  return {
    contentType: data.contentType,
    size: data.size,
    chunks: data.chunks,
    uid: data.uid,
    kind: data.kind,
  };
}

export async function readBlob(
  blobId: string,
  db: Firestore = getFirebaseAdminFirestore(),
): Promise<{ buffer: Buffer; meta: BlobMeta } | null> {
  const meta = await readBlobMeta(blobId, db);
  if (!meta) return null;
  const ref = db.collection("mediaBlobs").doc(blobId);
  const parts: Buffer[] = [];
  for (let index = 0; index < meta.chunks; index += 1) {
    const chunk = await ref.collection("chunks").doc(String(index)).get();
    const data = chunk.data()?.data;
    if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) return null;
    parts.push(Buffer.from(data as Uint8Array));
  }
  const buffer = joinChunks(parts);
  if (buffer.length !== meta.size) return null;
  return { buffer, meta };
}

export async function deleteBlob(
  blobId: string,
  db: Firestore = getFirebaseAdminFirestore(),
): Promise<void> {
  const meta = await readBlobMeta(blobId, db);
  const ref = db.collection("mediaBlobs").doc(blobId);
  const batch = db.batch();
  for (let index = 0; index < (meta?.chunks ?? 0); index += 1) {
    batch.delete(ref.collection("chunks").doc(String(index)));
  }
  batch.delete(ref);
  if (meta) {
    batch.set(
      db.collection("mediaStats").doc("global"),
      {
        count: FieldValue.increment(-1),
        bytes: FieldValue.increment(-meta.size),
      },
      { merge: true },
    );
  }
  await batch.commit();
}

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
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";
import { deleteUploadDocument } from "@/lib/server/user-data";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 4096;
const LIST_LIMIT = 200;

function toMillis(value: unknown): number {
  if (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof (value as { toMillis: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

// Lists the user's uploaded files (Settings → Data → Manage uploaded
// files). Reads users/{uid}/uploads newest-first, capped at 200.
export async function GET(request: NextRequest) {
  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }
  try {
    const db = getFirebaseAdminFirestore();
    const snapshot = await db
      .collection("users")
      .doc(auth.uid)
      .collection("uploads")
      .orderBy("createdAt", "desc")
      .limit(LIST_LIMIT)
      .get();
    const files = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: typeof data.name === "string" ? data.name : "Untitled file",
        size:
          typeof data.bytes === "number"
            ? data.bytes
            : typeof data.expectedBytes === "number"
              ? data.expectedBytes
              : 0,
        mimeType: typeof data.mimeType === "string" ? data.mimeType : "",
        status: typeof data.status === "string" ? data.status : "pending",
        createdAt: toMillis(data.createdAt),
      };
    });
    return NextResponse.json(
      { files },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Couldn’t list uploaded files.", error);
    return authErrorResponse(
      503,
      "FILES_UNAVAILABLE",
      "Your files couldn’t be loaded right now. Please try again.",
    );
  }
}

// Deletes one uploaded file: Cloudinary asset + Firestore document,
// reusing the same cleanup as the chat upload DELETE route. Unlike
// that route, deleting from Settings is allowed even when the file is
// attached to a message — the message keeps its metadata snapshot, and
// the brief assigns this management surface the stronger behaviour.
export async function DELETE(request: NextRequest) {
  const guarded = await guardAuthPost(request, MAX_BODY_BYTES);
  if (!guarded.ok) return guarded.response;

  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }

  // Phase 4 audit addition: file deletes from Settings are
  // destructive — cap at 60 per user per hour (fail closed).
  const deleteLimit = await checkWindowLimit(
    `xyro:settings:files-delete:user:${auth.uid}`,
    60 * 60 * 1000,
    60,
  );
  if (deleteLimit.state !== "allowed") {
    const limited = rateLimitedResponse(deleteLimit);
    return authErrorResponse(limited.status, limited.code, limited.message, {
      ...(limited.retryAfter
        ? { "Retry-After": String(limited.retryAfter) }
        : {}),
    });
  }

  const assetId = stringField(guarded.body, "assetId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) {
    return authErrorResponse(400, "INVALID_ASSET_ID", "The file ID isn’t valid.");
  }

  try {
    const db = getFirebaseAdminFirestore();
    const ref = db
      .collection("users")
      .doc(auth.uid)
      .collection("uploads")
      .doc(assetId);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return NextResponse.json(
        { success: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    await deleteUploadDocument(db, auth.uid, assetId, snapshot.data() ?? {});
    return NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Couldn’t delete the uploaded file.", error);
    return authErrorResponse(
      503,
      "FILE_DELETE_FAILED",
      "This file couldn’t be deleted. Please try again.",
    );
  }
}

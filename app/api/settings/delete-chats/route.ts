import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, guardAuthPost } from "@/lib/server/auth-guard";
import { authenticateSessionUser } from "@/lib/server/api-auth";
import {
  checkWindowLimit,
  rateLimitedResponse,
} from "@/lib/server/auth-rate-limit";
import {
  getFirebaseAdminDatabase,
  getFirebaseAdminFirestore,
} from "@/lib/server/firebase-admin";
import { deleteChatsChunk } from "@/lib/server/user-data";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY_BYTES = 4096;
const CHUNK_SIZE = 10;

// Delete all chats, in resumable chunks. Each call deletes up to
// CHUNK_SIZE chats (messages, their uploads + Cloudinary assets, and
// the Realtime Database stream nodes) and reports {done, deleted}; the
// client keeps calling until done is true, so an interrupted run can
// simply be resumed by pressing the button again. Limited to 3 runs
// per day per user (a "run" is counted on the first chunk of a run —
// continuation chunks carry {continuation: true} and are not counted,
// but are still authenticated and session-bound).
export async function POST(request: NextRequest) {
  const guarded = await guardAuthPost(request, MAX_BODY_BYTES);
  if (!guarded.ok) return guarded.response;

  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }

  if (guarded.body.confirmation !== "DELETE") {
    return authErrorResponse(
      400,
      "CONFIRMATION_REQUIRED",
      "Type DELETE to confirm removing all chats.",
    );
  }

  if (guarded.body.continuation !== true) {
    const rateLimit = await checkWindowLimit(
      `xyro:data:delete-chats:user:${auth.uid}`,
      24 * 60 * 60 * 1000,
      3,
    );
    if (rateLimit.state !== "allowed") {
      const limited = rateLimitedResponse(rateLimit);
      return authErrorResponse(
        limited.status,
        limited.code,
        "You can delete all chats at most 3 times a day.",
        {
          ...(limited.retryAfter
            ? { "Retry-After": String(limited.retryAfter) }
            : {}),
        },
      );
    }
  }

  try {
    const db = getFirebaseAdminFirestore();
    let realtimeDb: ReturnType<typeof getFirebaseAdminDatabase> | null = null;
    try {
      realtimeDb = getFirebaseAdminDatabase();
    } catch {
      realtimeDb = null;
    }
    const result = await deleteChatsChunk(
      db,
      auth.uid,
      CHUNK_SIZE,
      async (chatId) => {
        if (realtimeDb) {
          await realtimeDb.ref(`chatStreams/${auth.uid}/${chatId}`).remove();
        }
      },
    );
    return NextResponse.json(
      { done: !result.remaining, deleted: result.deletedChats },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Delete-all-chats chunk failed.", error);
    return authErrorResponse(
      503,
      "DELETE_CHATS_FAILED",
      "Some chats couldn’t be deleted. Try again to continue where it stopped.",
    );
  }
}

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
import {
  getFirebaseAdminAuth,
  getFirebaseAdminDatabase,
  getFirebaseAdminFirestore,
} from "@/lib/server/firebase-admin";
import { signInWithPasswordServer } from "@/lib/server/identity-toolkit";
import { clearSession, revokeAllSessionsForUser } from "@/lib/server/session";
import { deleteChatsChunk, deleteUploadDocument } from "@/lib/server/user-data";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY_BYTES = 4096;
const CHATS_PER_CHUNK = 10;
const UPLOADS_PER_CHUNK = 50;

// Delete account, in resumable chunks (1 run per day). The client
// calls repeatedly; each call advances the deletion by one stage and
// returns {done:false, stage} until everything is gone, then deletes
// the Firebase Auth user, revokes all sessions, clears the cookie and
// returns {done:true}. Stages, in order:
//   chats    — chats + messages + their uploads (Cloudinary + docs)
//              + Realtime Database stream nodes (deleteChatsChunk)
//   uploads  — any remaining uploads not tied to a deleted chat
//   records  — sessions + settings subcollections, presence node
//   profile  — the users/{uid} document itself
//   auth     — revokeAllSessionsForUser + Admin deleteUser
// Every stage is idempotent, so an interrupted run resumes safely by
// calling again. Chunk sizes keep a single call far below the
// Firestore free-tier daily delete budget (20k/day).
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
      "Type DELETE to confirm deleting your account.",
    );
  }

  const isContinuation = guarded.body.continuation === true;

  let adminAuth: ReturnType<typeof getFirebaseAdminAuth>;
  try {
    adminAuth = getFirebaseAdminAuth();
  } catch (error) {
    console.error("Firebase Admin account deletion is not configured.", error);
    return authErrorResponse(503, "AUTH_NOT_CONFIGURED", "Account services aren’t configured for this deployment.");
  }

  // Re-authentication happens on the first call of a run: password
  // accounts must prove the password server-side. Google-only accounts
  // rely on the fresh session + typed confirmation (their identity is
  // managed by Google; there is no password to check).
  if (!isContinuation) {
    const rateLimit = await checkWindowLimit(
      `xyro:account:delete:user:${auth.uid}`,
      24 * 60 * 60 * 1000,
      1,
    );
    if (rateLimit.state !== "allowed") {
      const limited = rateLimitedResponse(rateLimit);
      return authErrorResponse(
        limited.status,
        limited.code,
        "Account deletion can be started once a day.",
        {
          ...(limited.retryAfter
            ? { "Retry-After": String(limited.retryAfter) }
            : {}),
        },
      );
    }

    let user: Awaited<ReturnType<typeof adminAuth.getUser>>;
    try {
      user = await adminAuth.getUser(auth.uid);
    } catch (error) {
      console.error("Firebase user lookup failed for account deletion.", error);
      return authErrorResponse(503, "DELETE_FAILED", "We couldn’t start deleting your account. Please try again.");
    }
    const hasPassword = user.providerData.some(
      (provider) => provider.providerId === "password",
    );
    if (hasPassword) {
      const password = stringField(guarded.body, "password") ?? "";
      if (!password || !user.email) {
        return authErrorResponse(
          400,
          "PASSWORD_REQUIRED",
          "Enter your password to confirm deleting your account.",
        );
      }
      const reauth = await signInWithPasswordServer(user.email, password);
      if (reauth.state === "invalid_credentials") {
        return authErrorResponse(401, "CURRENT_PASSWORD_INCORRECT", "Your password is incorrect.");
      }
      if (reauth.state === "too_many_attempts") {
        return authErrorResponse(429, "RATE_LIMITED", "Too many attempts. Wait a little while, then try again.");
      }
      if (reauth.state !== "ok" || reauth.uid !== auth.uid) {
        return authErrorResponse(503, "REAUTH_UNAVAILABLE", "We couldn’t verify your password right now. Please try again.");
      }
    }
  }

  const db = getFirebaseAdminFirestore();
  const userRef = db.collection("users").doc(auth.uid);
  let realtimeDb: ReturnType<typeof getFirebaseAdminDatabase> | null = null;
  try {
    realtimeDb = getFirebaseAdminDatabase();
  } catch {
    realtimeDb = null;
  }
  const progress = (stage: string) =>
    NextResponse.json(
      { done: false, stage },
      { headers: { "Cache-Control": "no-store" } },
    );

  try {
    // Stage: chats (with messages, their uploads, stream nodes).
    const chats = await deleteChatsChunk(
      db,
      auth.uid,
      CHATS_PER_CHUNK,
      async (chatId) => {
        if (realtimeDb) {
          await realtimeDb.ref(`chatStreams/${auth.uid}/${chatId}`).remove();
        }
      },
    );
    if (chats.remaining) return progress("chats");

    // Stage: remaining uploads.
    const uploads = await userRef
      .collection("uploads")
      .limit(UPLOADS_PER_CHUNK)
      .get();
    if (!uploads.empty) {
      for (const doc of uploads.docs) {
        await deleteUploadDocument(db, auth.uid, doc.id, doc.data());
      }
      const more = await userRef.collection("uploads").limit(1).get();
      if (!more.empty) return progress("uploads");
    }

    // Stage: sessions + settings records, presence.
    for (const sub of ["sessions", "settings"] as const) {
      const docs = await userRef.collection(sub).limit(100).get();
      if (!docs.empty) {
        const batch = db.batch();
        docs.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
    }
    if (realtimeDb) {
      await realtimeDb.ref(`presence/${auth.uid}`).remove().catch(() => {});
      await realtimeDb.ref(`chatStreams/${auth.uid}`).remove().catch(() => {});
    }

    // Stage: profile document.
    const profile = await userRef.get();
    if (profile.exists) await userRef.delete();

    // Stage: Auth user + every session.
    await revokeAllSessionsForUser(auth.uid);
    try {
      await adminAuth.deleteUser(auth.uid);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code: unknown }).code
          : undefined;
      if (code !== "auth/user-not-found") throw error;
    }

    const response = NextResponse.json(
      { done: true },
      { headers: { "Cache-Control": "no-store" } },
    );
    clearSession(response);
    return response;
  } catch (error) {
    console.error("Account deletion chunk failed.", error);
    return authErrorResponse(
      503,
      "DELETE_FAILED",
      "Deletion stopped partway. Call again to continue where it stopped.",
    );
  }
}

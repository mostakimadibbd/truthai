import type { Firestore } from "firebase-admin/firestore";
import {
  deleteCloudinaryResource,
  type CloudinaryResourceType,
} from "@/lib/server/cloudinary";

// Shared cascade helpers for the Phase 3 data controls (delete one
// file, delete all chats, delete account). They reuse the same
// Cloudinary cleanup the single-upload DELETE route performs, so a
// file removed from Settings behaves exactly like one removed from
// chat: Cloudinary asset destroyed (authenticated type, invalidated),
// then the Firestore document deleted.

export async function deleteUploadDocument(
  db: Firestore,
  uid: string,
  assetId: string,
  data: FirebaseFirestore.DocumentData,
): Promise<void> {
  if (
    typeof data.publicId === "string" &&
    (data.resourceType === "image" || data.resourceType === "raw")
  ) {
    try {
      const result = await deleteCloudinaryResource(
        data.publicId,
        data.resourceType as CloudinaryResourceType,
      );
      if (result.result !== "ok" && result.result !== "not found") {
        console.error("Cloudinary delete returned an unexpected result.", result);
      }
    } catch (error) {
      // Best effort: a Cloudinary outage must not strand the Firestore
      // cleanup; the orphaned asset is private (authenticated delivery)
      // and unreachable without a signed URL.
      console.error("Cloudinary delete failed during data cleanup.", error);
    }
  }
  await db
    .collection("users")
    .doc(uid)
    .collection("uploads")
    .doc(assetId)
    .delete();
}

/**
 * Deletes up to `limit` chats (with their messages and any uploads that
 * belong to them) plus their Realtime Database stream nodes. Returns
 * how many chats were deleted and whether more remain, so callers can
 * loop in resumable chunks that respect the Firestore daily quota.
 */
export async function deleteChatsChunk(
  db: Firestore,
  uid: string,
  limit: number,
  deleteRtdbChat: (chatId: string) => Promise<void>,
): Promise<{ deletedChats: number; remaining: boolean }> {
  const userRef = db.collection("users").doc(uid);
  const chatsSnapshot = await userRef
    .collection("chats")
    .limit(limit)
    .get();
  if (chatsSnapshot.empty) return { deletedChats: 0, remaining: false };

  let deleted = 0;
  for (const chatDoc of chatsSnapshot.docs) {
    // Uploads that belong to this chat go with it (asset + document).
    const uploads = await userRef
      .collection("uploads")
      .where("chatId", "==", chatDoc.id)
      .limit(100)
      .get();
    for (const upload of uploads.docs) {
      await deleteUploadDocument(db, uid, upload.id, upload.data());
    }

    // Messages in batches of 400 (Firestore batch cap is 500).
    for (;;) {
      const messages = await chatDoc.ref
        .collection("messages")
        .limit(400)
        .get();
      if (messages.empty) break;
      const batch = db.batch();
      messages.docs.forEach((message) => batch.delete(message.ref));
      await batch.commit();
      if (messages.size < 400) break;
    }

    await chatDoc.ref.delete();
    await deleteRtdbChat(chatDoc.id).catch((error) =>
      console.error("Couldn’t remove the chat’s live stream node.", error),
    );
    deleted += 1;
  }

  const more = await userRef.collection("chats").limit(1).get();
  return { deletedChats: deleted, remaining: !more.empty };
}

import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, guardAuthPost } from "@/lib/server/auth-guard";
import { authenticateSessionUser } from "@/lib/server/api-auth";
import {
  checkWindowLimit,
  rateLimitedResponse,
} from "@/lib/server/auth-rate-limit";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";
import { sanitizePreferences } from "@/lib/preferences";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY_BYTES = 4096;
// Hard cap on exported documents (profile + settings + chats +
// messages + uploads combined) to stay inside the free Firestore read
// quota; the export says when it was truncated.
const MAX_DOCUMENTS = 2000;

function toIso(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof (value as { toMillis: unknown }).toMillis === "function"
  ) {
    return new Date((value as { toMillis: () => number }).toMillis()).toISOString();
  }
  return null;
}

type ExportData = {
  exportedAt: string;
  truncated: boolean;
  documentCount: number;
  profile: Record<string, unknown> | null;
  settings: ReturnType<typeof sanitizePreferences>;
  chats: {
    id: string;
    title: string;
    createdAt: string | null;
    updatedAt: string | null;
    messages: {
      id: string;
      role: string;
      content: string;
      createdAt: string | null;
      attachments: { name: string; mimeType: string; size: number }[];
    }[];
  }[];
  uploads: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    status: string;
    createdAt: string | null;
  }[];
};

function toMarkdown(data: ExportData): string {
  const lines: string[] = [
    "# Xyro AI data export",
    "",
    `Exported: ${data.exportedAt}`,
    ...(data.truncated ? ["", "_This export was truncated at the document cap._"] : []),
    "",
    "## Profile",
    "",
    ...(data.profile
      ? Object.entries(data.profile).map(([key, value]) => `- **${key}:** ${String(value)}`)
      : ["No profile found."]),
    "",
    "## Chats",
    "",
  ];
  for (const chat of data.chats) {
    lines.push(`### ${chat.title || "Untitled chat"}`, "");
    for (const message of chat.messages) {
      lines.push(`**${message.role === "user" ? "You" : "Xyro AI"}:** ${message.content}`, "");
    }
  }
  lines.push("## Uploaded files", "");
  for (const upload of data.uploads) {
    lines.push(`- ${upload.name} (${upload.mimeType}, ${upload.size} bytes)`);
  }
  return lines.join("\n");
}

// "Export my data" — 1 per day per user. Returns profile, settings,
// chats with their messages, and upload metadata (not file contents:
// those stay in Cloudinary and are listed by name/size). JSON by
// default, Markdown when format: "markdown".
export async function POST(request: NextRequest) {
  const guarded = await guardAuthPost(request, MAX_BODY_BYTES);
  if (!guarded.ok) return guarded.response;

  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }

  const format = guarded.body.format === "markdown" ? "markdown" : "json";

  const rateLimit = await checkWindowLimit(
    `xyro:data:export:user:${auth.uid}`,
    24 * 60 * 60 * 1000,
    1,
  );
  if (rateLimit.state !== "allowed") {
    const limited = rateLimitedResponse(rateLimit);
    return authErrorResponse(
      limited.status,
      limited.code,
      "You can export your data once a day.",
      {
        ...(limited.retryAfter
          ? { "Retry-After": String(limited.retryAfter) }
          : {}),
      },
    );
  }

  try {
    const db = getFirebaseAdminFirestore();
    const userRef = db.collection("users").doc(auth.uid);
    let count = 0;
    let truncated = false;
    const take = (n: number) => {
      count += n;
      if (count > MAX_DOCUMENTS) truncated = true;
      return count <= MAX_DOCUMENTS;
    };

    const [profileSnap, settingsSnap, uploadsSnap, chatsSnap] =
      await Promise.all([
        userRef.get(),
        userRef.collection("settings").doc("preferences").get(),
        userRef.collection("uploads").orderBy("createdAt", "desc").limit(500).get(),
        userRef.collection("chats").orderBy("updatedAt", "desc").limit(200).get(),
      ]);
    take(2 + uploadsSnap.size + chatsSnap.size);

    const profileData = profileSnap.data();
    const profile = profileData
      ? {
          uid: auth.uid,
          email: typeof profileData.email === "string" ? profileData.email : auth.email,
          displayName:
            typeof profileData.displayName === "string" ? profileData.displayName : "",
          photoURL: typeof profileData.photoURL === "string" ? profileData.photoURL : "",
          createdAt: toIso(profileData.createdAt),
          lastSignInAt: toIso(profileData.lastSignInAt),
        }
      : null;

    const uploads: ExportData["uploads"] = uploadsSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: typeof data.name === "string" ? data.name : "Untitled file",
        mimeType: typeof data.mimeType === "string" ? data.mimeType : "",
        size: typeof data.bytes === "number" ? data.bytes : 0,
        status: typeof data.status === "string" ? data.status : "pending",
        createdAt: toIso(data.createdAt),
      };
    });

    const chats: ExportData["chats"] = [];
    for (const chatDoc of chatsSnap.docs) {
      if (count > MAX_DOCUMENTS) {
        truncated = true;
        break;
      }
      const chatData = chatDoc.data();
      const messagesSnap = await chatDoc.ref
        .collection("messages")
        .orderBy("createdAt", "asc")
        .limit(500)
        .get();
      take(messagesSnap.size);
      chats.push({
        id: chatDoc.id,
        title: typeof chatData.title === "string" ? chatData.title : "Untitled chat",
        createdAt: toIso(chatData.createdAt),
        updatedAt: toIso(chatData.updatedAt),
        messages: messagesSnap.docs.map((messageDoc) => {
          const message = messageDoc.data();
          return {
            id: messageDoc.id,
            role: typeof message.role === "string" ? message.role : "user",
            content: typeof message.content === "string" ? message.content : "",
            createdAt: toIso(message.createdAt),
            attachments: Array.isArray(message.attachments)
              ? message.attachments.flatMap((item: unknown) => {
                  if (typeof item !== "object" || item === null) return [];
                  const record = item as Record<string, unknown>;
                  return [
                    {
                      name: typeof record.name === "string" ? record.name : "file",
                      mimeType:
                        typeof record.mimeType === "string" ? record.mimeType : "",
                      size: typeof record.size === "number" ? record.size : 0,
                    },
                  ];
                })
              : [],
          };
        }),
      });
    }

    const data: ExportData = {
      exportedAt: new Date().toISOString(),
      truncated,
      documentCount: count,
      profile,
      settings: sanitizePreferences(settingsSnap.data()),
      chats,
      uploads,
    };

    const filename = `xyro-data-export.${format === "markdown" ? "md" : "json"}`;
    return new NextResponse(
      format === "markdown" ? toMarkdown(data) : JSON.stringify(data, null, 2),
      {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type":
            format === "markdown"
              ? "text/markdown; charset=utf-8"
              : "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      },
    );
  } catch (error) {
    console.error("Data export failed.", error);
    return authErrorResponse(
      503,
      "EXPORT_FAILED",
      "Your export couldn’t be prepared right now. Please try again.",
    );
  }
}

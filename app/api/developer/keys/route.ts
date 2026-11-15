import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  guardAuthPost,
  stringField,
} from "@/lib/server/auth-guard";
import { authenticateSessionUser } from "@/lib/server/api-auth";
import {
  createApiKey,
  getDeveloperProfile,
  listApiKeys,
  revokeApiKey,
} from "@/lib/server/developer";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 4096;

function json(data: unknown) {
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}

// POST {action: "create", name} — issues a new key; the full key is
// returned exactly once. POST {action: "revoke", keyId} — revokes a
// key immediately (its auth lookup is deleted in the same batch).
export async function POST(request: NextRequest) {
  const guarded = await guardAuthPost(request, MAX_BODY_BYTES);
  if (!guarded.ok) return guarded.response;

  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }

  try {
    const profile = await getDeveloperProfile(auth.uid);
    if (!profile) {
      return authErrorResponse(
        400,
        "NOT_ACTIVATED",
        "Activate developer access before managing API keys.",
      );
    }

    const action = stringField(guarded.body, "action") ?? "";
    if (action === "create") {
      const name = (stringField(guarded.body, "name") ?? "").trim();
      if (name.length > 60) {
        return authErrorResponse(400, "INVALID_NAME", "Key names can be at most 60 characters.");
      }
      try {
        const { record, fullKey } = await createApiKey(
          auth.uid,
          name || "API key",
        );
        return json({ keyRecord: record, apiKey: fullKey });
      } catch (error) {
        if (error instanceof Error && error.message === "KEY_LIMIT") {
          return authErrorResponse(
            400,
            "KEY_LIMIT",
            "You already have the maximum number of active API keys. Revoke one before creating another.",
          );
        }
        throw error;
      }
    }

    if (action === "revoke") {
      const keyId = stringField(guarded.body, "keyId") ?? "";
      if (!keyId) {
        return authErrorResponse(400, "INVALID_KEY", "Choose a key to revoke.");
      }
      const revoked = await revokeApiKey(auth.uid, keyId);
      if (!revoked) {
        return authErrorResponse(404, "KEY_NOT_FOUND", "That key no longer exists.");
      }
      return json({ success: true, keys: await listApiKeys(auth.uid) });
    }

    return authErrorResponse(400, "INVALID_ACTION", "That action isn’t recognised.");
  } catch (error) {
    console.error("API key management failed.", error);
    return authErrorResponse(
      503,
      "KEY_ACTION_FAILED",
      "That key action couldn’t be completed. Please try again.",
    );
  }
}

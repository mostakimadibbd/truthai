import { NextRequest, NextResponse } from "next/server";
import { guardMutationHeaders } from "@/lib/server/auth-guard";
import {
  clearMemories,
  deleteMemory,
  listMemories,
  sanitizeMemoryText,
  saveMemories,
} from "@/lib/server/memory";
import { authenticateVerifiedUser } from "@/lib/server/request-auth";

export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** The signed-in user's saved memories (Settings → Personalization). */
export async function GET(request: NextRequest) {
  const auth = await authenticateVerifiedUser(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);
  try {
    const memories = await listMemories(auth.uid);
    return NextResponse.json(
      { memories },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Couldn't list memories.", error);
    return errorResponse(503, "MEMORY_UNAVAILABLE", "Memories couldn’t be loaded.");
  }
}

/** Add a memory the user typed themselves. */
export async function POST(request: NextRequest) {
  const guard = guardMutationHeaders(request);
  if (guard) return guard;
  const auth = await authenticateVerifiedUser(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "The request isn’t valid JSON.");
  }
  const text = sanitizeMemoryText(
    typeof body === "object" && body !== null && "text" in body ? body.text : "",
  );
  if (!text) {
    return errorResponse(400, "INVALID_MEMORY", "Write the fact you want Xyro AI to remember.");
  }
  try {
    await saveMemories(auth.uid, [text], "user");
    const memories = await listMemories(auth.uid);
    return NextResponse.json(
      { memories },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Couldn't save a memory.", error);
    return errorResponse(503, "MEMORY_UNAVAILABLE", "The memory couldn’t be saved.");
  }
}

/** Delete one memory ({id}) or all of them ({all: true}). */
export async function DELETE(request: NextRequest) {
  const guard = guardMutationHeaders(request);
  if (guard) return guard;
  const auth = await authenticateVerifiedUser(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "The request isn’t valid JSON.");
  }
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  try {
    if (record.all === true) {
      await clearMemories(auth.uid);
    } else if (typeof record.id === "string") {
      await deleteMemory(auth.uid, record.id);
    } else {
      return errorResponse(400, "INVALID_REQUEST", "Say which memory to delete.");
    }
    const memories = await listMemories(auth.uid);
    return NextResponse.json(
      { memories },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Couldn't delete memories.", error);
    return errorResponse(503, "MEMORY_UNAVAILABLE", "The memory couldn’t be deleted.");
  }
}

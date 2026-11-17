import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 30;

/** ?uid= lists the user's chats; ?uid=&chatId= reads one chat's
 * messages (the backend audits the view). */
export async function GET(request: NextRequest) {
  const uid = request.nextUrl.searchParams.get("uid") ?? "";
  const chatId = request.nextUrl.searchParams.get("chatId") ?? "";
  const path = chatId
    ? `/v1/admin/users/${encodeURIComponent(uid)}/chats/${encodeURIComponent(chatId)}`
    : `/v1/admin/users/${encodeURIComponent(uid)}/chats`;
  return proxyAdmin(request, path, { method: "GET" });
}

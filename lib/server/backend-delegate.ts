import { NextResponse } from "next/server";

import { recordBudget } from "@/lib/server/budget";

// Optional delegation to the Python backend service (backend/).
//
// When BACKEND_URL and BACKEND_SERVICE_TOKEN are set, eligible
// chat turns (plain text: no attachments, no web search, no
// regeneration) are executed by the persistent Python service
// instead of this serverless function. The service runs the turn
// as a job that is decoupled from every HTTP connection: if the
// user closes the tab mid-reply — which aborts this request and
// stops a locally-executed turn — the job still finishes and the
// reply is saved to Firestore, appearing when they return.
//
// This function is a thin client of that service:
//   * submit returns 202 with a job id;
//   * we poll the job (1.2s) and translate its outcome into the
//     exact response shapes the chat client already understands;
//   * if the poll outlives the function's budget, we answer
//     success anyway — the job completes regardless and the
//     client's Firestore/RTDB listeners deliver the result;
//   * if the service is unreachable at submit time, we return
//     null and the caller runs the turn locally, so the optional
//     backend can never take chat down with it.

type DelegateArgs = {
  request: Request;
  chatId: string;
  responseId: string;
  userMessageId: string;
  assistantMessageId: string;
  content: string;
  model: string | null;
};

function backendConfig(): { url: string; token: string } | null {
  const url = process.env.BACKEND_URL?.trim().replace(/\/+$/, "");
  const token = process.env.BACKEND_SERVICE_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

export function backendDelegationEnabled(): boolean {
  return backendConfig() !== null;
}

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function tryDelegateChatTurn(
  args: DelegateArgs,
): Promise<NextResponse | null> {
  const config = backendConfig();
  if (!config) return null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Service-Token": config.token,
    Authorization: args.request.headers.get("authorization") ?? "",
    Cookie: args.request.headers.get("cookie") ?? "",
  };

  let jobId: string;
  try {
    const submit = await fetch(`${config.url}/v1/chat/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        chatId: args.chatId,
        responseId: args.responseId,
        userMessageId: args.userMessageId,
        assistantMessageId: args.assistantMessageId,
        content: args.content,
        model: args.model,
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!submit.ok) {
      // ANY submit failure — unreachable, 5xx, and 401 alike —
      // falls back to local execution. A 401 from the backend
      // does NOT mean the session is invalid: this route has
      // already verified it locally (authenticateVerifiedUser),
      // so a backend rejection can only be a configuration
      // mismatch between the two deployments (SESSION_SECRET or
      // service token divergence). The optional backend must
      // never take chat down with it.
      if (submit.status === 401) {
        console.warn(
          "backend-delegate: backend rejected a locally verified session (401); " +
            "check SESSION_SECRET and BACKEND_SERVICE_TOKEN alignment. Running locally.",
        );
      }
      return null;
    }
    const created: unknown = await submit.json().catch(() => null);
    if (
      typeof created !== "object" ||
      created === null ||
      !("jobId" in created) ||
      typeof created.jobId !== "string"
    ) {
      return null;
    }
    jobId = created.jobId;
  } catch {
    return null; // backend unreachable: local execution takes over
  }

  const deadline = Date.now() + 270_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    try {
      const poll = await fetch(
        `${config.url}/v1/chat/jobs/${encodeURIComponent(jobId)}`,
        { headers, signal: AbortSignal.timeout(10_000), cache: "no-store" },
      );
      if (!poll.ok) continue;
      const status: unknown = await poll.json().catch(() => null);
      if (typeof status !== "object" || status === null || !("status" in status)) {
        continue;
      }
      if (status.status === "complete") {
        // Same post-turn accounting as the local path, with the
        // typical counts for a text turn (the budget model is an
        // estimate by design; see lib/server/budget.ts).
        await recordBudget({
          firestoreWrites: 5,
          firestoreReads: 12,
          redisCommands: 2,
        }).catch(() => undefined);
        return NextResponse.json(
          { success: true, delegated: true },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (status.status === "failed") {
        const error =
          "error" in status &&
          typeof status.error === "object" &&
          status.error !== null
            ? (status.error as { status?: number; code?: string; message?: string })
            : {};
        return errorJson(
          typeof error.status === "number" ? error.status : 503,
          typeof error.code === "string" ? error.code : "MODEL_UNAVAILABLE",
          typeof error.message === "string"
            ? error.message
            : "The free model service is temporarily unavailable.",
        );
      }
    } catch {
      // A failed poll says nothing about the job; keep waiting.
      continue;
    }
  }

  // The function is out of time but the job is not: it finishes
  // server-side and the reply lands in Firestore, where the
  // client's listeners pick it up.
  return NextResponse.json(
    { success: true, delegated: true, pending: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

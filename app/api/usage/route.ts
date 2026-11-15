import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-guard";
import { authenticateSessionUser } from "@/lib/server/api-auth";
import { getBudgetStatus } from "@/lib/server/budget";
import { peekRateLimitUsage } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

// Today's usage against the existing product limits. Counters are the
// same Redis keys the chat/upload limiters increment; this route only
// peeks (GET/PTTL), it never increments. Limits mirror the route code:
// /api/chat allows 10 messages/minute and 60/day; /api/uploads/sign
// allows 5/minute and 20/day. When Redis is not configured the counts
// are reported as unavailable rather than invented.
const CHAT_DAY_LIMIT = 60;
const CHAT_MINUTE_LIMIT = 10;
const UPLOAD_DAY_LIMIT = 20;
const UPLOAD_MINUTE_LIMIT = 5;

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }

  const [chat, uploads, budget] = await Promise.all([
    peekRateLimitUsage(auth.uid, "chat"),
    peekRateLimitUsage(auth.uid, "upload"),
    getBudgetStatus(),
  ]);
  const available = chat.state === "ok" && uploads.state === "ok";
  // The daily window is anchored at the first counted action of the
  // day (the limiter sets a 24 h TTL then), so the reset time is that
  // action + 24 h; with no counted actions yet, the window resets at
  // the next UTC midnight boundary of an unused day — reported as null
  // ("no usage yet") instead of a fabricated time.
  const resetAt = chat.dayResetAt ?? uploads.dayResetAt;

  return NextResponse.json(
    {
      available,
      messages: {
        today: chat.dayCount,
        dayLimit: CHAT_DAY_LIMIT,
        thisMinute: chat.minuteCount,
        minuteLimit: CHAT_MINUTE_LIMIT,
      },
      uploads: {
        today: uploads.dayCount,
        dayLimit: UPLOAD_DAY_LIMIT,
        thisMinute: uploads.minuteCount,
        minuteLimit: UPLOAD_MINUTE_LIMIT,
      },
      // Phase 4: the service-wide daily budget (Firestore writes are
      // the binding quota). Percentages are null when the budget
      // guard is not configured; state is "ok" | "queue" | "paused"
      // | "skipped" — see lib/server/budget.ts.
      budget: {
        state: budget.state,
        firestoreWritePercent: budget.firestoreWritePercent,
        firestoreReadPercent: budget.firestoreReadPercent,
        redisPercent: budget.redisPercent,
      },
      resetAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

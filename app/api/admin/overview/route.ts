import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-guard";
import { authenticateSessionUser } from "@/lib/server/api-auth";
import { isAdminEmail } from "@/lib/server/admin";
import {
  analyticsDayKey,
  getAnalyticsDayTotals,
  getAnalyticsMinuteSeries,
  getAnalyticsModelDay,
  getAnalyticsTopUsers,
  getRecentUsageEvents,
} from "@/lib/server/analytics";
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

function json(data: unknown) {
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}

// GET: the administrator console's data — today's platform totals,
// the last 60 minutes of token flow, today's per-model split, the
// top users by tokens (emails resolved for display), and the most
// recent entries of the token ledger. Gated on the signed-in
// account's email being on the admin allowlist; everyone else gets
// a plain 403 and no data.
export async function GET(request: NextRequest) {
  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }
  try {
    const adminAuth = getFirebaseAdminAuth();
    const user = await adminAuth.getUser(auth.uid);
    if (!isAdminEmail(user.email)) {
      return authErrorResponse(
        403,
        "ADMIN_ONLY",
        "This area is available to Xyro AI administrators only.",
      );
    }

    const today = analyticsDayKey();
    const [totals, minutes, models, topUsers, recentEvents, recentSearches] =
      await Promise.all([
        getAnalyticsDayTotals(today),
        getAnalyticsMinuteSeries(60),
        getAnalyticsModelDay(today),
        getAnalyticsTopUsers(today, 10),
        getRecentUsageEvents(50),
        // Recent web-search log (searchEvents): which queries ran,
        // what triggered them, which provider answered and how many
        // results came back — the visibility the owner asked for.
        getFirebaseAdminFirestore()
          .collection("searchEvents")
          .orderBy("ts", "desc")
          .limit(20)
          .get()
          .then((snapshot) =>
            snapshot.docs.map((doc) => {
              const data = doc.data();
              return {
                query: typeof data.query === "string" ? data.query : "",
                trigger: typeof data.trigger === "string" ? data.trigger : "",
                provider: typeof data.provider === "string" ? data.provider : null,
                resultCount:
                  typeof data.resultCount === "number" ? data.resultCount : 0,
                ts: typeof data.ts === "number" ? data.ts : 0,
              };
            }),
          )
          .catch(() => []),
      ]);

    // Resolve display emails for the top users and the ledger's
    // distinct users (best-effort; a deleted account shows its uid).
    const emailByUid = new Map<string, string>();
    const uidsToResolve = new Set<string>([
      ...topUsers.map((entry) => entry.uid),
      ...recentEvents.map((entry) => entry.uid),
    ]);
    await Promise.all(
      [...uidsToResolve].slice(0, 30).map(async (uid) => {
        try {
          const record = await adminAuth.getUser(uid);
          if (record.email) emailByUid.set(uid, record.email);
        } catch {
          // Deleted or unknown account: the uid is shown instead.
        }
      }),
    );

    return json({
      today,
      totals,
      minutes,
      models,
      topUsers: topUsers.map((entry) => ({
        ...entry,
        email: emailByUid.get(entry.uid) ?? null,
      })),
      recentEvents: recentEvents.map((entry) => ({
        ...entry,
        email: emailByUid.get(entry.uid) ?? null,
      })),
      recentSearches,
    });
  } catch (error) {
    console.error("Couldn’t load admin overview.", error);
    return authErrorResponse(
      503,
      "ADMIN_UNAVAILABLE",
      "Admin data couldn’t be loaded right now. Please try again.",
    );
  }
}

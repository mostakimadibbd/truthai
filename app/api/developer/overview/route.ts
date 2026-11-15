import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-guard";
import { authenticateSessionUser } from "@/lib/server/api-auth";
import {
  FREE_PLAN_DAILY_TOKEN_LIMIT,
  apiDateKey,
  getDailyUsage,
  getDeveloperProfile,
  getUsageRange,
  listApiAccessPoints,
  listApiEvents,
  listApiKeys,
  listApiModelUsage,
} from "@/lib/server/developer";
import { getFirebaseAdminAuth } from "@/lib/server/firebase-admin";
import { getFreeModels } from "@/lib/server/models";

export const runtime = "nodejs";
export const maxDuration = 30;

function json(data: unknown) {
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}

// GET: everything the Settings → Developer tab renders — activation
// profile, API keys (prefixes only), today's usage against the free
// plan limit, the last 7 days, and the recent fingerprinted request
// events.
export async function GET(request: NextRequest) {
  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return authErrorResponse(auth.status, auth.code, auth.message);
  }
  try {
    const user = await getFirebaseAdminAuth().getUser(auth.uid);
    const profile = await getDeveloperProfile(auth.uid);
    if (!profile) {
      return json({ activated: false, emailVerified: user.emailVerified });
    }
    const [keys, today, last7Days, recentEvents, modelUsage, accessPoints, catalogue] =
      await Promise.all([
        listApiKeys(auth.uid),
        getDailyUsage(auth.uid, apiDateKey()),
        getUsageRange(auth.uid, 7),
        listApiEvents(auth.uid, 10),
        listApiModelUsage(auth.uid, 7),
        listApiAccessPoints(auth.uid),
        getFreeModels(),
      ]);
    return json({
      activated: true,
      emailVerified: user.emailVerified,
      profile,
      keys,
      limit: FREE_PLAN_DAILY_TOKEN_LIMIT,
      usage: { today, last7Days },
      recentEvents,
      modelUsage,
      accessPoints,
      models: catalogue.models.map((model) => ({
        id: model.id,
        name: model.name,
        contextLength: model.contextLength,
        capabilities: model.capabilities,
        pricing: model.pricing,
      })),
    });
  } catch (error) {
    console.error("Couldn’t load developer overview.", error);
    return authErrorResponse(
      503,
      "DEVELOPER_UNAVAILABLE",
      "Developer details couldn’t be loaded right now. Please try again.",
    );
  }
}

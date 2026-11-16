import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-guard";
import {
  authenticateAdmin,
  isAdminRecord,
  recordAdminAction,
} from "@/lib/server/admin";
import { analyticsDayKey, getAnalyticsTopUsers } from "@/lib/server/analytics";
import {
  getFirebaseAdminAuth,
  getFirebaseAdminFirestore,
} from "@/lib/server/firebase-admin";
import {
  checkWindowLimit,
  rateLimitedResponse,
} from "@/lib/server/auth-rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

function json(data: unknown) {
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}

function toMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

const ACTIONS = ["promote", "demote", "disable", "enable"] as const;
type AdminAction = (typeof ACTIONS)[number];

// GET: the user directory for the admin console — every account
// (first 200) with its database admin flag, auth state and
// today's token consumption. Admin-gated; nothing here is
// reachable by a non-admin account.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request);
  if (!admin.ok) {
    return authErrorResponse(admin.status, admin.code, admin.message);
  }
  try {
    const adminAuth = getFirebaseAdminAuth();
    const firestore = getFirebaseAdminFirestore();
    const today = analyticsDayKey();
    const [authPage, profiles, usage] = await Promise.all([
      adminAuth.listUsers(200),
      firestore.collection("users").limit(500).get(),
      getAnalyticsTopUsers(today, 500).catch(() => []),
    ]);
    const profileByUid = new Map(
      profiles.docs.map((doc) => [doc.id, doc.data() as Record<string, unknown>]),
    );
    const usageByUid = new Map(usage.map((entry) => [entry.uid, entry]));

    const users = authPage.users.map((record) => {
      const profile = profileByUid.get(record.uid);
      const totals = usageByUid.get(record.uid);
      return {
        uid: record.uid,
        email: record.email ?? null,
        displayName:
          record.displayName ??
          (typeof profile?.displayName === "string" ? profile.displayName : null),
        emailVerified: record.emailVerified,
        disabled: record.disabled,
        admin: isAdminRecord(profile),
        createdAt: toMs(record.metadata.creationTime),
        lastSignInAt: toMs(record.metadata.lastSignInTime),
        requestsToday: totals?.requests ?? 0,
        totalTokensToday: totals?.totalTokens ?? 0,
        costUsdToday: totals?.costUsd ?? 0,
      };
    });
    users.sort((a, b) => {
      if (a.admin !== b.admin) return a.admin ? -1 : 1;
      return b.totalTokensToday - a.totalTokensToday;
    });
    return json({ today, users, truncated: Boolean(authPage.pageToken) });
  } catch (error) {
    console.error("Couldn’t load admin users.", error);
    return authErrorResponse(
      503,
      "ADMIN_UNAVAILABLE",
      "Admin data couldn’t be loaded right now. Please try again.",
    );
  }
}

// PATCH: one control action on one account — promote/demote
// writes the database admin flag; disable/enable flips the
// Firebase Auth disabled state. An admin cannot demote or
// disable their own account (lockout protection). Every action
// is written to the adminActions audit trail.
export async function PATCH(request: NextRequest) {
  const admin = await authenticateAdmin(request);
  if (!admin.ok) {
    return authErrorResponse(admin.status, admin.code, admin.message);
  }
  const rateLimit = await checkWindowLimit(
    `xyro:admin:users:actor:${admin.uid}`,
    60 * 1000,
    60,
  );
  if (rateLimit.state !== "allowed") {
    const limited = rateLimitedResponse(rateLimit);
    return authErrorResponse(limited.status, limited.code, limited.message, {
      ...(limited.retryAfter
        ? { "Retry-After": String(limited.retryAfter) }
        : {}),
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return authErrorResponse(400, "INVALID_BODY", "Request body must be JSON.");
  }
  const targetUid = typeof body.uid === "string" ? body.uid : "";
  const action = body.action as AdminAction;
  if (!targetUid || !ACTIONS.includes(action)) {
    return authErrorResponse(
      400,
      "INVALID_ACTION",
      "A target user and a valid action are required.",
    );
  }
  if (targetUid === admin.uid && (action === "demote" || action === "disable")) {
    return authErrorResponse(
      400,
      "SELF_ACTION",
      "You can’t demote or disable your own admin account.",
    );
  }

  try {
    if (action === "promote" || action === "demote") {
      await getFirebaseAdminFirestore()
        .doc(`users/${targetUid}`)
        .set({ admin: action === "promote" }, { merge: true });
    } else {
      await getFirebaseAdminAuth().updateUser(targetUid, {
        disabled: action === "disable",
      });
    }
    await recordAdminAction(admin.uid, targetUid, action);
    return json({ success: true, uid: targetUid, action });
  } catch (error) {
    console.error("Admin user action failed.", error);
    return authErrorResponse(
      503,
      "ACTION_FAILED",
      "That action couldn’t be completed. Please try again.",
    );
  }
}

import { FieldValue } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";
import { getFirebaseAdminFirestore } from "@/lib/server/firebase-admin";

// Firestore session records: users/{uid}/sessions/{sid}.
//
// One small document per signed-in session powers the Settings →
// Security session list. Records are created best-effort at login (from
// the sign-in / sign-up / Google session routes, where the sid is
// minted) and their lastActiveAt is touched at most once every 6 hours
// from the session-status probe, so the Firestore cost is bounded: one
// write per login plus at most 4 touches a day per active device.
// Revoking a session deletes its record and sets the Redis
// revoked:{sid} flag (see lib/server/session.ts), which is what
// actually stops that device's API access immediately.

export type SessionRecord = {
  sid: string;
  device: string;
  city: string | null;
  country: string | null;
  createdAt: number;
  lastActiveAt: number;
  current: boolean;
};

const TOUCH_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function deviceLabelFromUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const os = /Windows NT/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone/.test(userAgent)
        ? "iPhone"
        : /iPad/.test(userAgent)
          ? "iPad"
          : /Mac OS X/.test(userAgent)
            ? "macOS"
            : /Linux/.test(userAgent)
              ? "Linux"
              : "Unknown system";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\/|Opera/.test(userAgent)
      ? "Opera"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Browser";
  return `${browser} on ${os}`;
}

function sessionsCollection(uid: string) {
  return getFirebaseAdminFirestore()
    .collection("users")
    .doc(uid)
    .collection("sessions");
}

/** Best-effort: creates (or refreshes) the record for a fresh login. */
export async function recordSessionLogin(
  uid: string,
  sid: string,
  request: NextRequest,
): Promise<void> {
  try {
    const city = request.headers.get("x-vercel-ip-city");
    const country = request.headers.get("x-vercel-ip-country");
    await sessionsCollection(uid)
      .doc(sid)
      .set(
        {
          device: deviceLabelFromUserAgent(request.headers.get("user-agent")),
          city: city ? decodeURIComponent(city).slice(0, 100) : null,
          country: country ? country.slice(0, 4) : null,
          createdAt: FieldValue.serverTimestamp(),
          lastActiveAt: FieldValue.serverTimestamp(),
        },
        { merge: false },
      );
  } catch (error) {
    // A missing session record must never break sign-in.
    console.error("Couldn’t record the session for the settings list.", error);
  }
}

/** Best-effort touch, throttled to one write per 6 hours per session. */
export async function touchSessionRecord(
  uid: string,
  sid: string,
  request: NextRequest,
): Promise<void> {
  try {
    const ref = sessionsCollection(uid).doc(sid);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      await recordSessionLogin(uid, sid, request);
      return;
    }
    const lastActive = snapshot.data()?.lastActiveAt;
    const lastMs =
      lastActive && typeof lastActive.toMillis === "function"
        ? lastActive.toMillis()
        : 0;
    if (Date.now() - lastMs < TOUCH_INTERVAL_MS) return;
    await ref.update({ lastActiveAt: FieldValue.serverTimestamp() });
  } catch (error) {
    console.error("Couldn’t touch the session record.", error);
  }
}

function toMillis(value: unknown): number {
  if (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof (value as { toMillis: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export async function listSessionRecords(
  uid: string,
  currentSid: string,
): Promise<SessionRecord[]> {
  const snapshot = await sessionsCollection(uid)
    .orderBy("lastActiveAt", "desc")
    .limit(50)
    .get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      sid: doc.id,
      device:
        typeof data.device === "string" ? data.device : "Unknown device",
      city: typeof data.city === "string" ? data.city : null,
      country: typeof data.country === "string" ? data.country : null,
      createdAt: toMillis(data.createdAt),
      lastActiveAt: toMillis(data.lastActiveAt),
      current: doc.id === currentSid,
    };
  });
}

export async function deleteSessionRecord(
  uid: string,
  sid: string,
): Promise<void> {
  await sessionsCollection(uid).doc(sid).delete();
}

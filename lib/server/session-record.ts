import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";
import { getDeviceContext, type DeviceContext } from "@/lib/server/device";
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
//
// Device security data (see lib/device-fingerprint.ts and
// lib/server/device.ts): each login also carries a client device
// fingerprint hash. Logins upsert users/{uid}/devices/{deviceId}
// (first/last seen, login count, browser/OS label) and append to
// users/{uid}/securityEvents (sign-in, sign-up, new-device and
// velocity events). A device id the account has never seen marks the
// session record newDevice so Settings can badge it. IPs are stored
// only as HMAC hashes. All of it is best-effort: none of it may ever
// break a sign-in.

export type SessionRecord = {
  sid: string;
  device: string;
  city: string | null;
  country: string | null;
  createdAt: number;
  lastActiveAt: number;
  current: boolean;
  deviceId: string | null;
  authMethod: string | null;
  newDevice: boolean;
};

export type DeviceRecord = {
  deviceId: string;
  label: string;
  browser: string;
  os: string;
  deviceType: string;
  firstSeenAt: number;
  lastSeenAt: number;
  loginCount: number;
};

export type SecurityEventRecord = {
  id: string;
  type: string;
  deviceLabel: string | null;
  createdAt: number;
};

export type LoginEventType = "sign_in" | "sign_up" | "google_sign_in";

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

function devicesCollection(uid: string) {
  return getFirebaseAdminFirestore()
    .collection("users")
    .doc(uid)
    .collection("devices");
}

function securityEventsCollection(uid: string) {
  return getFirebaseAdminFirestore()
    .collection("users")
    .doc(uid)
    .collection("securityEvents");
}

/** Best-effort: appends one entry to the account's security activity. */
export async function recordSecurityEvent(
  uid: string,
  event: {
    type: LoginEventType | "new_device" | "device_velocity";
    context: DeviceContext;
  },
): Promise<void> {
  try {
    await securityEventsCollection(uid).add({
      type: event.type,
      deviceId: event.context.deviceId,
      deviceLabel: event.context.label,
      ipHash: event.context.ipHash,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("Couldn’t record a security event.", error);
  }
}

/**
 * Best-effort: creates the record for a fresh login, upserts the
 * device registry entry and appends the security activity events.
 * `options.deviceId` is the raw client-supplied fingerprint (validated
 * here); `options.eventType` distinguishes password sign-in, sign-up
 * and Google sign-in in the activity feed.
 */
export async function recordSessionLogin(
  uid: string,
  sid: string,
  request: NextRequest,
  options?: { deviceId?: unknown; eventType?: LoginEventType },
): Promise<void> {
  try {
    const context = getDeviceContext(request, options?.deviceId);
    const city = request.headers.get("x-vercel-ip-city");
    const country = request.headers.get("x-vercel-ip-country");

    // Device registry: a fingerprint this account has never seen is a
    // new device — badge the session and log a dedicated event.
    let newDevice = false;
    if (context.deviceId) {
      const deviceRef = devicesCollection(uid).doc(context.deviceId);
      const existing = await deviceRef.get();
      newDevice = !existing.exists;
      if (newDevice) {
        await deviceRef.set({
          deviceId: context.deviceId,
          label: context.label,
          browser: context.browser,
          os: context.os,
          deviceType: context.deviceType,
          userAgent: context.userAgent,
          firstSeenAt: FieldValue.serverTimestamp(),
          lastSeenAt: FieldValue.serverTimestamp(),
          lastIpHash: context.ipHash,
          loginCount: 1,
        });
      } else {
        await deviceRef.update({
          label: context.label,
          browser: context.browser,
          os: context.os,
          deviceType: context.deviceType,
          userAgent: context.userAgent,
          lastSeenAt: FieldValue.serverTimestamp(),
          lastIpHash: context.ipHash,
          loginCount: FieldValue.increment(1),
        });
      }
    }

    await sessionsCollection(uid)
      .doc(sid)
      .set(
        {
          device: context.label,
          deviceId: context.deviceId,
          authMethod:
            options?.eventType === "google_sign_in"
              ? "google"
              : options?.eventType
                ? "password"
                : null,
          newDevice,
          ipHash: context.ipHash,
          city: city ? decodeURIComponent(city).slice(0, 100) : null,
          country: country ? country.slice(0, 4) : null,
          createdAt: FieldValue.serverTimestamp(),
          lastActiveAt: FieldValue.serverTimestamp(),
        },
        { merge: false },
      );

    if (options?.eventType) {
      await recordSecurityEvent(uid, { type: options.eventType, context });
      if (newDevice) {
        await recordSecurityEvent(uid, { type: "new_device", context });
      }
    }
  } catch (error) {
    // A missing session record must never break sign-in.
    console.error("Couldn’t record the session for the settings list.", error);
  }
}

/**
 * Sign-up velocity signal: maintains the top-level deviceSignals
 * counter for a fingerprint and reports whether the device looks
 * abusive (many accounts created from it). Informational only — the
 * caller logs a security event; sign-up is never blocked on this,
 * because households and classrooms legitimately share devices.
 */
export async function recordDeviceSignUp(
  deviceId: string | null,
  uid: string,
): Promise<{ flagged: boolean }> {
  if (!deviceId) return { flagged: false };
  try {
    const db = getFirebaseAdminFirestore();
    const ref = db.collection("deviceSignals").doc(deviceId);
    const uidHash = createHash("sha256").update(uid).digest("hex");
    const snapshot = await ref.get();
    const data = snapshot.data();
    const knownHashes: string[] = Array.isArray(data?.uidHashes)
      ? (data.uidHashes as string[])
      : [];
    const isNewAccount = !knownHashes.includes(uidHash);
    const totalSignUps =
      (typeof data?.totalSignUps === "number" ? data.totalSignUps : 0) +
      (isNewAccount ? 1 : 0);
    await ref.set(
      {
        totalSignUps,
        uidHashes:
          isNewAccount && knownHashes.length < 25
            ? [...knownHashes, uidHash]
            : knownHashes,
        lastSignUpAt: FieldValue.serverTimestamp(),
      },
      { merge: false },
    );
    return { flagged: totalSignUps >= 5 };
  } catch (error) {
    console.error("Couldn’t update the device sign-up signal.", error);
    return { flagged: false };
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
      deviceId: typeof data.deviceId === "string" ? data.deviceId : null,
      authMethod: typeof data.authMethod === "string" ? data.authMethod : null,
      newDevice: data.newDevice === true,
    };
  });
}

export async function listDevices(uid: string): Promise<DeviceRecord[]> {
  const snapshot = await devicesCollection(uid)
    .orderBy("lastSeenAt", "desc")
    .limit(20)
    .get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      deviceId: doc.id,
      label: typeof data.label === "string" ? data.label : "Unknown device",
      browser: typeof data.browser === "string" ? data.browser : "Browser",
      os: typeof data.os === "string" ? data.os : "Unknown system",
      deviceType:
        typeof data.deviceType === "string" ? data.deviceType : "desktop",
      firstSeenAt: toMillis(data.firstSeenAt),
      lastSeenAt: toMillis(data.lastSeenAt),
      loginCount: typeof data.loginCount === "number" ? data.loginCount : 0,
    };
  });
}

export async function listSecurityEvents(
  uid: string,
): Promise<SecurityEventRecord[]> {
  const snapshot = await securityEventsCollection(uid)
    .orderBy("createdAt", "desc")
    .limit(10)
    .get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      type: typeof data.type === "string" ? data.type : "sign_in",
      deviceLabel:
        typeof data.deviceLabel === "string" ? data.deviceLabel : null,
      createdAt: toMillis(data.createdAt),
    };
  });
}

export async function deleteSessionRecord(
  uid: string,
  sid: string,
): Promise<void> {
  await sessionsCollection(uid).doc(sid).delete();
}

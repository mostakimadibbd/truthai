/**
 * Who counts as a Xyro AI administrator, and the shared helpers
 * every admin surface uses.
 *
 * The source of truth is the database: a user's profile document
 * (users/{uid}) carries an `admin` field, and only an account
 * whose document says `admin: true` holds admin power. Profile
 * documents are writable ONLY by the server (Firestore rules deny
 * all client writes), so no user can promote themselves — the
 * flag can be set from the admin console (by an existing admin)
 * or directly in the Firestore console by the project owner.
 *
 * The email allowlist below remains as a bootstrap/recovery path:
 * it guarantees the platform owner can always get in (for example
 * to set the very first database flag), even before any flag
 * exists. Both checks run server-side on every admin request;
 * nothing about admin status is ever trusted from the client.
 */
import type { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { authenticateSessionUser } from "./api-auth";
import {
  getFirebaseAdminAuth,
  getFirebaseAdminFirestore,
} from "./firebase-admin";

const BOOTSTRAP_ADMIN_EMAILS = ["mostakimbdyt@gmail.com"];

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const configured = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set([...BOOTSTRAP_ADMIN_EMAILS, ...configured]);
  return allowed.has(email.toLowerCase());
}

/** Pure predicate: does this profile document mark its owner as
 * an administrator? Kept pure so it is unit-testable. */
export function isAdminRecord(
  data: Record<string, unknown> | null | undefined,
): boolean {
  return data?.admin === true;
}

/** Full check for one signed-in user: database flag first-class,
 * bootstrap allowlist as the recovery path. */
export async function isAdminUser(
  uid: string,
  email: string | null | undefined,
): Promise<boolean> {
  if (isAdminEmail(email)) return true;
  try {
    const snapshot = await getFirebaseAdminFirestore()
      .doc(`users/${uid}`)
      .get();
    return isAdminRecord(snapshot.data() as Record<string, unknown>);
  } catch {
    return false;
  }
}

export type AdminAuth =
  | { ok: true; uid: string; email: string | null }
  | { ok: false; status: number; code: string; message: string };

/** Session auth + admin gate in one step, for admin API routes. */
export async function authenticateAdmin(
  request: NextRequest,
): Promise<AdminAuth> {
  const auth = await authenticateSessionUser(request);
  if (!auth.ok) {
    return {
      ok: false,
      status: auth.status,
      code: auth.code,
      message: auth.message,
    };
  }
  try {
    const record = await getFirebaseAdminAuth().getUser(auth.uid);
    if (!(await isAdminUser(auth.uid, record.email))) {
      return {
        ok: false,
        status: 403,
        code: "ADMIN_ONLY",
        message: "This area is available to Xyro AI administrators only.",
      };
    }
    return { ok: true, uid: auth.uid, email: record.email ?? null };
  } catch {
    return {
      ok: false,
      status: 503,
      code: "ADMIN_UNAVAILABLE",
      message: "Admin data couldn’t be loaded right now. Please try again.",
    };
  }
}

export type BackendStatus = {
  configured: boolean;
  reachable: boolean;
  executionMode: string | null;
  watermarkEngine: string | null;
  integrationsOk: boolean | null;
};

/**
 * Probe the Python backend's health from the server. The
 * backend's address is a server-only secret: it is read from the
 * environment here and NEVER included in the result, so the
 * admin console can show the service's state without exposing
 * where it lives.
 */
export async function getBackendStatus(): Promise<BackendStatus> {
  const base = (process.env.BACKEND_URL ?? "").trim().replace(/\/+$/, "");
  const token = (process.env.BACKEND_SERVICE_TOKEN ?? "").trim();
  if (!base || !token) {
    return {
      configured: false,
      reachable: false,
      executionMode: null,
      watermarkEngine: null,
      integrationsOk: null,
    };
  }
  try {
    const response = await fetch(`${base}/health`, {
      headers: { "X-Service-Token": token },
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("health not ok");
    const payload = (await response.json()) as {
      integrations?: Record<string, boolean>;
      executionMode?: string;
      watermarkEngine?: string;
    };
    const integrations = payload.integrations ?? {};
    return {
      configured: true,
      reachable: true,
      executionMode:
        typeof payload.executionMode === "string"
          ? payload.executionMode
          : null,
      watermarkEngine:
        typeof payload.watermarkEngine === "string"
          ? payload.watermarkEngine
          : null,
      integrationsOk:
        Object.keys(integrations).length > 0
          ? Object.values(integrations).every(Boolean)
          : null,
    };
  } catch {
    return {
      configured: true,
      reachable: false,
      executionMode: null,
      watermarkEngine: null,
      integrationsOk: null,
    };
  }
}

/** Audit trail for admin actions (promote/demote/disable/enable).
 * Stored top-level and admin-only: Firestore rules deny all
 * client access to the collection. */
export async function recordAdminAction(
  actorUid: string,
  targetUid: string,
  action: string,
): Promise<void> {
  try {
    await getFirebaseAdminFirestore()
      .collection("adminActions")
      .add({
        actorUid,
        targetUid,
        action,
        ts: Date.now(),
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch {
    // Auditing must never block the action itself.
  }
}

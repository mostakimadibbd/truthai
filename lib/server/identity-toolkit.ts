import { siteUrl } from "@/lib/site";
import { serverEnv } from "./env";

// Server-side calls to the Firebase Identity Toolkit REST API. Calling
// sign-in / OOB-code endpoints from the server (instead of the browser
// SDK) is what lets Turnstile gate them: the client never talks to
// Firebase until the server has verified the Turnstile token and minted
// a session. A Referer equal to the site origin is sent so Firebase API
// key referrer restrictions still pass.

const IDENTITY_TOOLKIT_BASE = "https://identitytoolkit.googleapis.com/v1";

function apiKey(): string | null {
  return serverEnv.firebaseWebApiKey || null;
}

export function isIdentityToolkitConfigured(): boolean {
  return apiKey() !== null;
}

type ToolkitError = { message?: unknown };

async function callToolkit(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; errorCode: string | null; status: number }> {
  const key = apiKey();
  if (!key) return { ok: false, errorCode: null, status: 0 };

  let response: Response;
  try {
    response = await fetch(`${IDENTITY_TOOLKIT_BASE}/${path}?key=${key}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: `${siteUrl}/`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { ok: false, errorCode: null, status: 0 };
  }

  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }
  if (response.ok) return { ok: true, data };

  const error = data.error as ToolkitError | undefined;
  return {
    ok: false,
    errorCode: typeof error?.message === "string" ? error.message : null,
    status: response.status,
  };
}

export type PasswordSignInResult =
  | { state: "ok"; uid: string; idToken: string; email: string }
  | { state: "invalid_credentials" }
  | { state: "disabled" }
  | { state: "too_many_attempts" }
  | { state: "unavailable" }
  | { state: "misconfigured" };

export async function signInWithPasswordServer(
  email: string,
  password: string,
): Promise<PasswordSignInResult> {
  if (!isIdentityToolkitConfigured()) return { state: "misconfigured" };
  const result = await callToolkit("accounts:signInWithPassword", {
    email,
    password,
    returnSecureToken: true,
  });
  if (!result.ok) {
    switch (result.errorCode) {
      case "EMAIL_NOT_FOUND":
      case "INVALID_PASSWORD":
      case "INVALID_LOGIN_CREDENTIALS":
      case "INVALID_EMAIL":
        return { state: "invalid_credentials" };
      case "USER_DISABLED":
        return { state: "disabled" };
      case "TOO_MANY_ATTEMPTS_TRY_LATER":
        return { state: "too_many_attempts" };
      default:
        return { state: "unavailable" };
    }
  }
  const uid = result.data.localId;
  const idToken = result.data.idToken;
  const signedInEmail = result.data.email;
  if (
    typeof uid !== "string" ||
    typeof idToken !== "string" ||
    typeof signedInEmail !== "string"
  ) {
    return { state: "unavailable" };
  }
  return { state: "ok", uid, idToken, email: signedInEmail };
}

export type SendOobResult =
  | { state: "ok" }
  | { state: "unavailable" }
  | { state: "misconfigured" };

/**
 * Sends a Firebase OOB email (password reset or verification) from the
 * server, using Firebase's own mail delivery.
 */
export async function sendOobCodeServer(options: {
  requestType: "PASSWORD_RESET" | "VERIFY_EMAIL";
  email?: string;
  idToken?: string;
}): Promise<SendOobResult> {
  if (!isIdentityToolkitConfigured()) return { state: "misconfigured" };
  const result = await callToolkit("accounts:sendOobCode", {
    requestType: options.requestType,
    ...(options.email ? { email: options.email } : {}),
    ...(options.idToken ? { idToken: options.idToken } : {}),
    returnOobLink: false,
  });
  // For password resets, "email not found" style errors are deliberately
  // folded into the caller's generic response; the route decides.
  return result.ok ? { state: "ok" } : { state: "unavailable" };
}

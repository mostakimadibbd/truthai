import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdminAuth } from "@/lib/server/firebase-admin";
import { verifyTurnstileToken } from "@/lib/server/turnstile";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 16_384;
const MAX_PASSWORD_LENGTH = 1024;
const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";

type SignUpBody = {
  email?: unknown;
  password?: unknown;
  displayName?: unknown;
  turnstileToken?: unknown;
  termsAccepted?: unknown;
};

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function getErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

async function checkPasswordNotBreached(password: string): Promise<
  | { state: "safe" }
  | { state: "breached" }
  | { state: "unavailable" }
> {
  const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  let response: Response;
  try {
    response = await fetch(`${HIBP_RANGE_URL}${hash.slice(0, 5)}`, {
      headers: { "Add-Padding": "true" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { state: "unavailable" };
  }
  if (!response.ok) return { state: "unavailable" };

  let lines: string[];
  try {
    lines = (await response.text()).split(/\r?\n/);
  } catch {
    return { state: "unavailable" };
  }

  const suffix = hash.slice(5);
  return lines.some((line) => {
    const [candidate, count] = line.split(":");
    return candidate?.toUpperCase() === suffix && Number(count) > 0;
  })
    ? { state: "breached" }
    : { state: "safe" };
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "This request origin isn’t allowed.");
  }

  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  const contentLength = Number(request.headers.get("content-length"));
  if (
    contentType !== "application/json" ||
    (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES)
  ) {
    return errorResponse(400, "INVALID_REQUEST", "The sign-up request isn’t valid.");
  }

  let body: SignUpBody;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return errorResponse(400, "INVALID_REQUEST", "The sign-up request is too large.");
    }
    body = JSON.parse(rawBody) as SignUpBody;
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "The sign-up request isn’t valid JSON.");
  }

  if (
    typeof body.email !== "string" ||
    body.email.trim().length === 0 ||
    body.email.trim().length > 254 ||
    typeof body.password !== "string" ||
    body.password.length < 10 ||
    body.password.length > MAX_PASSWORD_LENGTH ||
    body.termsAccepted !== true ||
    (body.displayName !== undefined &&
      (typeof body.displayName !== "string" || body.displayName.length > 100)) ||
    typeof body.turnstileToken !== "string" ||
    body.turnstileToken.length === 0 ||
    body.turnstileToken.length > 2048
  ) {
    return errorResponse(400, "INVALID_SIGN_UP", "Check the name, email, password, and security check.");
  }

  const verification = await verifyTurnstileToken(
    body.turnstileToken,
    request.nextUrl.hostname,
  );
  if (verification.state === "misconfigured") {
    return errorResponse(503, "TURNSTILE_NOT_CONFIGURED", "Account security verification isn’t configured.");
  }
  if (verification.state === "unavailable") {
    return errorResponse(503, "TURNSTILE_UNAVAILABLE", "Security verification is temporarily unavailable.");
  }
  if (verification.state === "invalid") {
    return errorResponse(403, "TURNSTILE_INVALID", "The security check expired or was invalid. Please try again.");
  }

  const passwordCheck = await checkPasswordNotBreached(body.password);
  if (passwordCheck.state === "unavailable") {
    return errorResponse(503, "PASSWORD_CHECK_UNAVAILABLE", "We couldn’t check this password right now. Please try again.");
  }
  if (passwordCheck.state === "breached") {
    return errorResponse(400, "PASSWORD_BREACHED", "This password appears in known data breaches. Please choose another one.");
  }

  let adminAuth: ReturnType<typeof getFirebaseAdminAuth>;
  try {
    adminAuth = getFirebaseAdminAuth();
  } catch (error) {
    console.error("Firebase Admin sign-up is not configured.", error);
    return errorResponse(503, "SIGN_UP_NOT_CONFIGURED", "Account creation isn’t configured for this deployment.");
  }

  let user;
  try {
    user = await adminAuth.createUser({
      email: body.email.trim(),
      password: body.password,
      displayName: typeof body.displayName === "string" ? body.displayName.trim() : undefined,
    });
  } catch (error) {
    const code = getErrorCode(error);
    if (code === "auth/email-already-exists") {
      return errorResponse(409, "EMAIL_IN_USE", "An account already uses this email. Sign in instead.");
    }
    if (code === "auth/invalid-email" || code === "auth/invalid-password") {
      return errorResponse(400, "INVALID_SIGN_UP", "Check your email address and password, then try again.");
    }
    console.error("Firebase account creation failed.", error);
    return errorResponse(503, "ACCOUNT_CREATION_FAILED", "We couldn’t create your account right now. Please try again.");
  }

  try {
    const customToken = await adminAuth.createCustomToken(user.uid);
    return NextResponse.json(
      { customToken },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Firebase custom token creation failed after account creation.", error);
    return errorResponse(
      503,
      "ACCOUNT_CREATED_SIGN_IN_FAILED",
      "Your account was created, but we couldn’t start its session. Sign in with your new credentials.",
    );
  }
}

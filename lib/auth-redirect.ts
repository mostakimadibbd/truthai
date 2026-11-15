// Shared validation for post-sign-in redirect targets ("next" paths).
//
// A next path is only ever a same-origin relative path: it must start
// with a single "/", must not be protocol-relative ("//host"), must not
// contain a backslash (some browsers treat "\" as "/"), a scheme
// ("https://…"), or control characters. Anything else is rejected and
// callers fall back to a safe default. This module has no imports so it
// can run in the Edge middleware as well as in client components.

const AUTH_PAGES = ["/", "/sign-in", "/sign-up", "/forgot-password"];

export function sanitizeNextPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (path.length === 0 || path.length > 512) return null;
  if (!path.startsWith("/")) return null;
  if (path.startsWith("//")) return null; // protocol-relative URL
  if (path.includes("\\")) return null; // backslash tricks
  if (path.includes("://")) return null; // absolute URL smuggled in
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return null;
  // Auth pages are never a useful post-sign-in destination (the
  // middleware would bounce a signed-in user to /chat anyway).
  const pathname = path.split(/[?#]/)[0];
  if (AUTH_PAGES.includes(pathname)) return "/chat";
  return path;
}

/** The path to send a signed-in user to, given a raw "next" value. */
export function nextPathOrDefault(value: unknown): string {
  return sanitizeNextPath(value) ?? "/chat";
}

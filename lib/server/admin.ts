/**
 * Who counts as a Xyro AI administrator. The admin console and its
 * API are gated on the signed-in account's email being on this
 * allowlist — checked server-side on every request, never trusted
 * from the client. The platform owner's email is the bootstrap
 * entry; extend or override it with the ADMIN_EMAILS environment
 * variable (comma-separated) in the deployment.
 */

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

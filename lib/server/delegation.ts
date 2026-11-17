import { createHmac } from "node:crypto";

// Signed delegation assertions for the Python backend.
//
// The chat route verifies the user's Firebase ID token itself
// (authenticateVerifiedUser — signature + verified email), then
// mints one of these to vouch for that uid on the delegated
// call: base64url(JSON {uid, exp}) + "." + hex HMAC-SHA256 of
// the payload, keyed with the shared backend service token.
//
// Why this exists: the backend originally re-verified the
// session cookie with its own SESSION_SECRET, so any secret
// drift between the two deployments silently disabled
// delegation (chat fell back to local execution and the
// backend's provider keys went unused). The assertion removes
// that coupling — the backend verifies the HMAC with the
// service token it already shares with this app, and STILL
// independently verifies the forwarded Firebase ID token and
// requires its uid to match the asserted one. Assertions live
// for six minutes, covering a submit plus its polling window.
export const DELEGATION_ASSERTION_TTL_SECONDS = 360;

export function mintDelegationAssertion(
  uid: string,
  serviceToken: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const payload = Buffer.from(
    JSON.stringify({ uid, exp: nowSeconds + DELEGATION_ASSERTION_TTL_SECONDS }),
    "utf8",
  ).toString("base64url");
  const signature = createHmac("sha256", serviceToken)
    .update(payload)
    .digest("hex");
  return `${payload}.${signature}`;
}

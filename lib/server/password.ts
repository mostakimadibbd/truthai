import { createHash } from "node:crypto";

// Shared breached-password check (Have I Been Pwned range API,
// k-anonymity: only the first 5 characters of the SHA-1 hash leave the
// server). Extracted from the sign-up route in Phase 3 so sign-up and
// change-password apply exactly the same rule.

export type PasswordBreachResult =
  | { state: "safe" }
  | { state: "breached" }
  | { state: "unavailable" };

export async function checkPasswordNotBreached(
  password: string,
): Promise<PasswordBreachResult> {
  const hash = createHash("sha1")
    .update(password, "utf8")
    .digest("hex")
    .toUpperCase();
  let response: Response;
  try {
    response = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
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

/**
 * Normalises a PEM private key supplied through an environment variable.
 *
 * Service-account keys are usually copied out of a JSON file into a
 * dashboard field, and that copy step mangles them in a handful of
 * predictable ways: literal "\n" escapes, double-escaped "\\n", real
 * newlines, surrounding quotes from the JSON string, the whole JSON
 * document pasted instead of the field, a base64-encoded PEM, or a
 * single line whose line breaks were turned into spaces. The previous
 * loader only handled the first case, and every other shape made
 * firebase-admin throw "Failed to parse private key"
 * (ERR_OSSL_UNSUPPORTED) at sign-in time.
 *
 * This function repairs each of those shapes. It never logs or returns
 * anything but the normalised key itself.
 */
export function normalizeAdminPrivateKey(
  raw: string | undefined,
): string | undefined {
  if (!raw) return undefined;
  let key = raw.trim();
  if (!key) return undefined;

  // The whole service-account JSON was pasted: extract its private_key.
  if (key.startsWith("{")) {
    try {
      const parsed = JSON.parse(key) as { private_key?: unknown };
      if (typeof parsed.private_key === "string" && parsed.private_key) {
        key = parsed.private_key.trim();
      }
    } catch {
      // Not JSON after all; continue with the raw value.
    }
  }

  // Surrounding quotes from copying the JSON string value verbatim.
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }

  // Base64-encoded PEM (the value itself carries no PEM markers).
  if (!key.includes("-----BEGIN")) {
    const compact = key.replace(/\s/g, "");
    if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length % 4 === 0) {
      try {
        const decoded = Buffer.from(compact, "base64").toString("utf8");
        if (decoded.includes("-----BEGIN")) {
          key = decoded.trim();
        }
      } catch {
        // Not base64; continue with the raw value.
      }
    }
  }

  // Double-escaped sequences first ("\\n" as three characters), then the
  // standard escaped forms, then real CRLF.
  key = key
    .replace(/\\\\n/g, "\\n")
    .replace(/\\\\r/g, "\\r")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\r\n/g, "\n");

  // The PEM lost its line breaks entirely (one line, spaces where the
  // breaks were): rebuild it with 64-character base64 lines.
  if (key.includes("-----BEGIN") && !key.includes("\n")) {
    const match = key.match(/-----BEGIN ([A-Z0-9 ]+?)-----(.+?)-----END \1-----/);
    if (match) {
      const body = match[2].replace(/\s+/g, "");
      const lines = body.match(/.{1,64}/g) ?? [];
      key = `-----BEGIN ${match[1]}-----\n${lines.join("\n")}\n-----END ${match[1]}-----`;
    }
  }

  return key.trim();
}

const configuredUrl = process.env.SITE_URL?.trim();
const previewUrl =
  process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : undefined;
const candidateUrl = configuredUrl || previewUrl || "https://xyro.ai";
const parsedUrl = new URL(candidateUrl);

if (
  parsedUrl.pathname !== "/" ||
  parsedUrl.search ||
  parsedUrl.hash ||
  (parsedUrl.protocol !== "https:" &&
    !(
      process.env.NODE_ENV !== "production" &&
      parsedUrl.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname)
    ))
) {
  throw new Error(
    "SITE_URL must be an HTTPS origin (or a localhost HTTP origin in development).",
  );
}

export const siteUrl = parsedUrl.origin;

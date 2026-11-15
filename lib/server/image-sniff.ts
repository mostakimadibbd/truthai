// Magic-byte sniffing for uploaded images (shared by the avatar route;
// Phase 4 reuses it for general upload content validation). The
// declared Content-Type is never trusted on its own.

export type SniffedImage = "png" | "jpeg" | "webp" | "gif" | null;

export function sniffImageType(buffer: Buffer): SniffedImage {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  if (
    buffer.length >= 6 &&
    (buffer.toString("ascii", 0, 6) === "GIF87a" ||
      buffer.toString("ascii", 0, 6) === "GIF89a")
  ) {
    return "gif";
  }
  return null;
}

export const IMAGE_MIME_BY_SNIFF: Record<
  Exclude<SniffedImage, null>,
  string
> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

// --- General upload content validation (Phase 4) --------------------
// /api/uploads/confirm verifies the ACTUAL bytes of an uploaded file
// against the format recorded at sign time, not just Cloudinary's
// metadata: magic bytes for the binary formats, UTF-8 validity for
// the text formats. A mislabelled file (e.g. a PNG renamed to .pdf)
// is rejected and its Cloudinary asset deleted.

export type SniffedFileType =
  | Exclude<SniffedImage, null>
  | "pdf"
  | "text"
  | null;

export function sniffFileType(buffer: Buffer): SniffedFileType {
  const image = sniffImageType(buffer);
  if (image) return image;
  // PDF: the "%PDF-" header must appear at the very start (strict —
  // some readers scan the first KB, but our own uploads are produced
  // by real PDF writers, which always lead with it).
  if (buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-") {
    return "pdf";
  }
  if (isValidUtf8Text(buffer)) return "text";
  return null;
}

/**
 * Strict UTF-8 text check: the bytes must decode as UTF-8 without
 * errors and contain no NUL or disallowed control characters (tab,
 * LF, CR and FF are fine). `allowTrailingPartial` is for head-only
 * validation of a truncated stream: a multi-byte sequence cut off at
 * the end of the sampled prefix is not treated as invalid.
 */
export function isValidUtf8Text(
  buffer: Buffer,
  options?: { allowTrailingPartial?: boolean },
): boolean {
  if (buffer.length === 0) return true;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    if (!options?.allowTrailingPartial) return false;
    // Retry with up to 3 trailing bytes dropped (a truncated
    // multi-byte sequence is at most 3 bytes incomplete).
    for (let drop = 1; drop <= 3 && drop < buffer.length; drop += 1) {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, buffer.length - drop),
        );
        return isCleanText(text);
      } catch {
        // Keep dropping.
      }
    }
    return false;
  }
  return isCleanText(text);
}

function isCleanText(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0) return false;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d && code !== 0x0c) {
      return false;
    }
    if (code === 0x7f) return false;
  }
  return true;
}

export type ContentValidation =
  | { ok: true; detected: Exclude<SniffedFileType, null> }
  | { ok: false; detected: SniffedFileType };

/**
 * Validate sampled bytes against the format recorded for an upload.
 * `format` is the upload-policy format: jpg, png, webp, gif, pdf,
 * txt, md or csv. For text formats the sample may be a head prefix
 * (see isValidUtf8Text's allowTrailingPartial).
 */
export function validateUploadContent(
  buffer: Buffer,
  format: string,
): ContentValidation {
  if (format === "txt" || format === "md" || format === "csv") {
    return isValidUtf8Text(buffer, { allowTrailingPartial: true })
      ? { ok: true, detected: "text" }
      : { ok: false, detected: null };
  }
  const detected = sniffFileType(buffer);
  const expected: SniffedFileType =
    format === "jpg" ? "jpeg" : (format as SniffedFileType);
  return detected === expected
    ? { ok: true, detected: expected as Exclude<SniffedFileType, null> }
    : { ok: false, detected };
}

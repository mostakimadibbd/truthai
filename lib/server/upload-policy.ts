import type { CloudinaryResourceType } from "@/lib/server/cloudinary";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_ATTACHMENTS_PER_CHAT = 50;
export const MAX_ATTACHMENT_BYTES_PER_MESSAGE = 20 * 1024 * 1024;

export type UploadSpec = {
  mimeType: string;
  format: string;
  resourceType: CloudinaryResourceType;
};

const SPECS_BY_EXTENSION: Record<string, UploadSpec> = {
  jpg: { mimeType: "image/jpeg", format: "jpg", resourceType: "image" },
  jpeg: { mimeType: "image/jpeg", format: "jpg", resourceType: "image" },
  png: { mimeType: "image/png", format: "png", resourceType: "image" },
  webp: { mimeType: "image/webp", format: "webp", resourceType: "image" },
  gif: { mimeType: "image/gif", format: "gif", resourceType: "image" },
  pdf: { mimeType: "application/pdf", format: "pdf", resourceType: "raw" },
  txt: { mimeType: "text/plain", format: "txt", resourceType: "raw" },
  md: { mimeType: "text/markdown", format: "md", resourceType: "raw" },
  csv: { mimeType: "text/csv", format: "csv", resourceType: "raw" },
};

const MIME_ALIASES: Record<string, string[]> = {
  "image/jpeg": ["image/jpeg", "image/pjpeg"],
  "image/png": ["image/png"],
  "image/webp": ["image/webp"],
  "image/gif": ["image/gif"],
  "application/pdf": ["application/pdf"],
  "text/plain": ["text/plain"],
  "text/markdown": ["text/markdown", "text/x-markdown", "text/plain"],
  "text/csv": ["text/csv", "application/vnd.ms-excel", "text/plain"],
};

export function getUploadSpec(fileName: string, mimeType: string): UploadSpec | null {
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  if (!extension) return null;
  const spec = SPECS_BY_EXTENSION[extension];
  if (!spec) return null;

  const normalizedMimeType = mimeType.trim().toLowerCase();
  if (
    normalizedMimeType &&
    !MIME_ALIASES[spec.mimeType]?.includes(normalizedMimeType)
  ) {
    return null;
  }
  return spec;
}

export function sanitizeUploadName(value: string): string {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)!
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 180);
}

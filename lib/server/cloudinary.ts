import { v2 as cloudinary } from "cloudinary";

export type CloudinaryResourceType = "image" | "raw";

type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

/**
 * Core account config: cloud name + API key/secret. Everything
 * server-side (generated-image and avatar uploads, signed private
 * download URLs, resource reads/deletes) needs only this. The
 * upload preset is required ONLY by the browser direct-upload
 * signing flow, so it is read separately there — a missing preset
 * must not break generated images or avatars.
 */
function getCloudinaryConfig(): CloudinaryConfig {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary account credentials are not configured.");
  }

  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  return { cloudName, apiKey, apiSecret };
}

function getCloudinaryUploadPreset(): string {
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET?.trim();
  if (!uploadPreset) {
    throw new Error("The signed Cloudinary upload preset is not configured.");
  }
  return uploadPreset;
}

export function createCloudinaryUploadSignature(params: {
  timestamp: number;
  public_id: string;
  type: "authenticated";
}) {
  const config = getCloudinaryConfig();
  const uploadPreset = getCloudinaryUploadPreset();
  const signedParams = { ...params, upload_preset: uploadPreset };
  return {
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    uploadPreset,
    signature: cloudinary.utils.api_sign_request(signedParams, config.apiSecret),
  };
}


/**
 * Extract a short, safe-to-show reason from a Cloudinary failure.
 * SDK errors arrive as { error: { message, http_code } } or plain
 * Errors; Cloudinary's messages ("Invalid credentials", "Unknown
 * API key", plan/limit notices) never contain secret values, but
 * anything that smells like a credential or a signed URL is dropped
 * wholesale rather than redacted.
 */
export function cloudinaryErrorMessage(error: unknown): string {
  let raw = "";
  if (error instanceof Error) raw = error.message;
  else if (error && typeof error === "object") {
    const nested = (error as { error?: { message?: unknown } }).error;
    if (nested && typeof nested.message === "string") raw = nested.message;
    else if (typeof (error as { message?: unknown }).message === "string")
      raw = String((error as { message: unknown }).message);
  }
  raw = raw.trim().replace(/\s+/g, " ").slice(0, 160);
  if (!raw) return "Cloudinary rejected the upload.";
  if (/api_secret|cloudinary:\/\/[^\s]*@/i.test(raw)) return "Cloudinary rejected the upload.";
  return raw;
}

/** Coarse, fixed-vocabulary classification of a live Admin API probe. */
export function classifyCloudinaryHttp(status: number, message: string): string {
  const text = message.toLowerCase();
  if (status === 401 || text.includes("invalid credentials") || text.includes("unknown api key")) return "invalid_credentials";
  if (status === 403 || status === 420 || text.includes("limit") || text.includes("exceeded") || text.includes("blocked")) return "account_limited";
  if (status >= 500) return "cloudinary_unavailable";
  return "unknown";
}

export type CloudinaryLiveCheck = {
  ok: boolean;
  errorKind: string | null;
  creditsPercent: number | null;
};

/**
 * Prove the configured credentials actually work against the live
 * Cloudinary Admin API (usage endpoint) — presence checks cannot
 * distinguish a correct secret from a mistyped one, and EVERY image
 * path (generated, avatar, user files) dies the same silent death
 * when the trio is wrong. Returns a coarse classification only;
 * never credential material.
 */
export async function checkCloudinaryLive(): Promise<CloudinaryLiveCheck> {
  try {
    getCloudinaryConfig();
  } catch {
    return { ok: false, errorKind: "not_configured", creditsPercent: null };
  }
  try {
    const usage = (await Promise.race([
      cloudinary.api.usage(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("cloudinary-probe-timeout")), 6_000),
      ),
    ])) as { credits?: { usage?: number; limit?: number } };
    let creditsPercent: number | null = null;
    const credits = usage?.credits;
    if (
      credits &&
      typeof credits.limit === "number" &&
      credits.limit > 0 &&
      typeof credits.usage === "number"
    ) {
      creditsPercent = Math.round((credits.usage / credits.limit) * 1000) / 10;
    }
    return { ok: true, errorKind: null, creditsPercent };
  } catch (error) {
    if (error instanceof Error && error.message === "cloudinary-probe-timeout") {
      return { ok: false, errorKind: "network", creditsPercent: null };
    }
    const status =
      (error as { error?: { http_code?: number } } | null)?.error?.http_code ?? 0;
    return {
      ok: false,
      errorKind: classifyCloudinaryHttp(status, cloudinaryErrorMessage(error)),
      creditsPercent: null,
    };
  }
}

/** One upload_stream call, normalised to the fields callers use. */
function uploadStreamOnce(
  options: Record<string, unknown>,
  buffer: Buffer,
): Promise<{ secure_url?: string; public_id: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      options,
      (error, uploaded) => {
        if (error || !uploaded) {
          reject(error ?? new Error("Cloudinary upload failed."));
          return;
        }
        resolve({
          secure_url: uploaded.secure_url,
          public_id: uploaded.public_id,
          bytes: uploaded.bytes,
        });
      },
    );
    stream.end(buffer);
  });
}

/** Upload with one retry — a transient network/5xx failure at
 * Cloudinary must not surface to the user as a lost picture. */
async function uploadStreamWithRetry(
  options: Record<string, unknown>,
  buffer: Buffer,
): Promise<{ secure_url?: string; public_id: string; bytes: number }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await uploadStreamOnce(options, buffer);
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1_200));
      }
    }
  }
  throw lastError ?? new Error("Cloudinary upload failed.");
}

export async function getCloudinaryResource(
  publicId: string,
  resourceType: CloudinaryResourceType,
) {
  getCloudinaryConfig();
  return cloudinary.api.resource(publicId, {
    resource_type: resourceType,
    type: "authenticated",
  });
}

export function getCloudinaryPrivateDownloadUrl(
  publicId: string,
  format: string,
  resourceType: CloudinaryResourceType,
) {
  getCloudinaryConfig();
  return cloudinary.utils.private_download_url(publicId, format, {
    resource_type: resourceType,
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + 15 * 60,
  });
}

/**
 * Uploads a profile avatar (Phase 3). Unlike chat attachments, avatars
 * are public profile pictures, so they use delivery type "upload"
 * under xyro/avatars/{uid} with a random public id, overwrite +
 * invalidate, exactly as the settings brief specifies. The caller has
 * already validated the bytes (image magic bytes, 2 MB cap, 256px
 * square crop done client-side).
 */
export async function uploadAvatarImage(
  buffer: Buffer,
  uid: string,
): Promise<{ url: string; publicId: string }> {
  getCloudinaryConfig();
  const publicId = `avatar-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const result = await uploadStreamWithRetry(
    {
      public_id: publicId,
      folder: `xyro/avatars/${uid}`,
      type: "upload",
      overwrite: true,
      invalidate: true,
      resource_type: "image",
    },
    buffer,
  );
  return { url: result.secure_url ?? "", publicId: result.public_id };
}

/**
 * Uploads a generated image (Phase 7). The buffer has ALREADY been
 * watermarked by the caller (lib/server/watermark.ts) — the
 * unwatermarked original is never stored. Generated pictures use
 * the same authenticated (private) delivery as user uploads, under
 * xyro/generated/{uid}, with the generation id as the public id so
 * the asset is traceable back to its watermark payload.
 */
export async function uploadGeneratedImage(
  buffer: Buffer,
  uid: string,
  generationId: string,
): Promise<{ publicId: string; bytes: number }> {
  getCloudinaryConfig();
  const result = await uploadStreamWithRetry(
    {
      public_id: generationId,
      folder: `xyro/generated/${uid}`,
      type: "authenticated",
      resource_type: "image",
      format: "png",
      overwrite: false,
    },
    buffer,
  );
  return { publicId: result.public_id, bytes: result.bytes };
}

/**
 * Server-mediated user file upload (the fallback path when a
 * browser's direct-to-Cloudinary upload is rejected — preset or
 * signature trouble can never break this route, because the SDK
 * uploads with the account secret directly, exactly like
 * generated images and avatars). The caller has already
 * validated the bytes against the declared format.
 */
export async function uploadUserFile(
  buffer: Buffer,
  options: {
    publicId: string;
    resourceType: CloudinaryResourceType;
    format: string;
  },
): Promise<{ publicId: string; bytes: number }> {
  getCloudinaryConfig();
  const result = await uploadStreamWithRetry(
    {
      public_id: options.publicId,
      type: "authenticated",
      resource_type: options.resourceType,
      format: options.resourceType === "image" ? undefined : options.format,
      overwrite: false,
    },
    buffer,
  );
  return { publicId: result.public_id, bytes: result.bytes };
}

export async function deleteCloudinaryResource(
  publicId: string,
  resourceType: CloudinaryResourceType,
) {
  getCloudinaryConfig();
  return cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
    type: "authenticated",
    invalidate: true,
  });
}

import { v2 as cloudinary } from "cloudinary";

export type CloudinaryResourceType = "image" | "raw";

type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  uploadPreset: string;
};

function getCloudinaryConfig(): CloudinaryConfig {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET?.trim();
  if (!cloudName || !apiKey || !apiSecret || !uploadPreset) {
    throw new Error("Cloudinary upload credentials or the signed upload preset are not configured.");
  }

  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  return { cloudName, apiKey, apiSecret, uploadPreset };
}

export function createCloudinaryUploadSignature(params: {
  timestamp: number;
  public_id: string;
  type: "authenticated";
  overwrite: false;
}) {
  const config = getCloudinaryConfig();
  const signedParams = { ...params, upload_preset: config.uploadPreset };
  return {
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    uploadPreset: config.uploadPreset,
    signature: cloudinary.utils.api_sign_request(signedParams, config.apiSecret),
  };
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
  const result = await new Promise<{
    secure_url: string;
    public_id: string;
  }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        folder: `xyro/avatars/${uid}`,
        type: "upload",
        overwrite: true,
        invalidate: true,
        resource_type: "image",
      },
      (error, uploaded) => {
        if (error || !uploaded) {
          reject(error ?? new Error("Cloudinary avatar upload failed."));
          return;
        }
        resolve({
          secure_url: uploaded.secure_url,
          public_id: uploaded.public_id,
        });
      },
    );
    stream.end(buffer);
  });
  return { url: result.secure_url, publicId: result.public_id };
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
  const result = await new Promise<{
    public_id: string;
    bytes: number;
  }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: generationId,
        folder: `xyro/generated/${uid}`,
        type: "authenticated",
        resource_type: "image",
        format: "png",
        overwrite: false,
      },
      (error, uploaded) => {
        if (error || !uploaded) {
          reject(error ?? new Error("Cloudinary generated-image upload failed."));
          return;
        }
        resolve({ public_id: uploaded.public_id, bytes: uploaded.bytes });
      },
    );
    stream.end(buffer);
  });
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

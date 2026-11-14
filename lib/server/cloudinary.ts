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

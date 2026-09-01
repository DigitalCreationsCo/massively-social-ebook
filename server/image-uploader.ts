import crypto from "node:crypto";
import { GCPStorageManager } from "./storage-manager";
import { generateStoryImage } from "./blocks/ai";

/**
 * Singleton GCPStorageManager for image uploads.
 * Lazily initialized on first use so that env vars are available.
 */
let gcsImageStorageInstance: GCPStorageManager | null = null;

export function getGcsImageStorage(): GCPStorageManager {
  if (!gcsImageStorageInstance) {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || "";
    const bucket = process.env.GOOGLE_CLOUD_BUCKET;
    if (!bucket) {
      throw new Error(
        "GCS image upload requires GOOGLE_CLOUD_BUCKET environment variable",
      );
    }
    gcsImageStorageInstance = new GCPStorageManager(projectId, bucket);
  }
  return gcsImageStorageInstance;
}

/**
 * Image type categorisation used to build the GCS path.
 * - `block`:  images accompanying story blocks (the primary narrative images)
 * - `cover`:  channel cover / profile images
 * - `pending`: pre-generated images stored in pending_blocks for the next vote
 */
export type ImageType = "block" | "cover" | "pending" | "ambient";

/** Finished generated image bytes, ready for direct queue ingestion or archival. */
export interface GeneratedStoryImage {
  buffer: Buffer;
  mimeType: "image/jpeg";
  filename: string;
}

/**
 * Builds a deterministic GCS object path for a generated image.
 *
 * Pattern: `channels/{channelId}/images/{type}/{uuid}.jpg`
 *
 * Uses crypto.randomUUID() for uniqueness so multiple generations for the
 * same description never collide at the storage layer.
 */
export function buildImagePath(
  channelId: string,
  imageType: ImageType,
): string {
  const uuid = crypto.randomUUID();
  const folderMap: Record<ImageType, string> = {
    block: "blocks",
    cover: "cover",
    pending: "pending",
    ambient: "ambient",
  };
  return `channels/${channelId}/images/${folderMap[imageType]}/${uuid}.jpg`;
}

/**
 * Generates a story image through the configured AI SDK provider and uploads it to GCS in one step.
 *
 * 1. Calls `generateStoryImage(description)` which returns raw base64.
 * 2. Builds a unique GCS path scoped to the channel and image type.
 * 3. Uploads via `GCPStorageManager.uploadBase64Image`.
 * 4. Returns an **HTTPS public URL** suitable for browser consumption.
 *
 * @param description - Image prompt sent to the AI model.
 * @param channelId   - The channel (string ID) to scope the storage path.
 * @param imageType   - Category of image ('block', 'cover', or 'pending').
 * @returns A public HTTPS URL pointing to the object in GCS.
 * @throws If image generation or upload fails (caller should handle fallback).
 */
export async function generateAndUploadStoryImage(
  description: string,
  channelId: string,
  imageType: ImageType,
): Promise<string> {
  return archiveStoryImage(await generateStoryImageAsset(description), channelId, imageType);
}

/** Generate image bytes without making object storage part of broadcast ingestion. */
export async function generateStoryImageAsset(description: string): Promise<GeneratedStoryImage> {
  const base64Data = await generateStoryImage(description);
  const normalized = base64Data.replace(/^data:image\/[^;]+;base64,/, "");
  const buffer = Buffer.from(normalized, "base64");
  if (buffer.length === 0) throw new Error("Image generator returned empty image data");
  return { buffer, mimeType: "image/jpeg", filename: `story-${crypto.randomUUID()}.jpg` };
}

/** Archive a generated image separately from its direct streamer upload. */
export async function archiveStoryImage(
  image: GeneratedStoryImage,
  channelId: string,
  imageType: ImageType,
): Promise<string> {
  const gcs = getGcsImageStorage();
  const path = buildImagePath(channelId, imageType);
  const gsUri = await gcs.uploadBase64Image(image.buffer.toString("base64"), path, image.mimeType);
  return gcs.getPublicUrl(gsUri);
}

/**
 * Uploads a pre-existing base64 image string to GCS.
 * Useful for the data-migration script or when the image was generated
 * outside of `generateAndUploadStoryImage`.
 *
 * @param base64Data - Raw base64 payload (WITHOUT `data:image/...;base64,` prefix).
 * @param channelId  - The channel to scope the storage path.
 * @param imageType  - Category of image ('block', 'cover', or 'pending').
 * @returns A public HTTPS URL pointing to the object in GCS.
 */
export async function uploadBase64Image(
  base64Data: string,
  channelId: string,
  imageType: ImageType,
): Promise<string> {
  const gcs = getGcsImageStorage();
  const path = buildImagePath(channelId, imageType);
  const gsUri = await gcs.uploadBase64Image(base64Data, path, "image/jpeg");
  return gcs.getPublicUrl(gsUri);
}

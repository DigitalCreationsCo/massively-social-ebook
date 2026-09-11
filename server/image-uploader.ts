import { generateUUID } from "@portalshq/capability-realtime-fanout";
import { GCPStorageManager } from "./storage-manager";
import { generateStoryImage } from "./blocks/ai";
import { admitBatchImageWork, admitImageProviderWork } from "./blocks/provider-budget";
import { getAiConfiguration } from "./blocks/ai-provider";
import {
  fetchReferenceImages,
  getImageReferenceLimits,
  type SelectedImageRepresentation,
} from "./blocks/image-references";

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

export interface StoryImageAssetOptions {
  /** Preference-selected references from nested entity representations. */
  imageRepresentations?: readonly SelectedImageRepresentation[];
  /** Broadcast abort signal, forwarded through downloads + generation. */
  signal?: AbortSignal;
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
  const uuid = generateUUID();
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
 * 1. Calls `generateStoryImageAsset(description, options)` which resolves
 *    reference buffers (when provided) and returns raw bytes.
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
  options: StoryImageAssetOptions = {},
): Promise<string> {
  return archiveStoryImage(await generateStoryImageAsset(description, options), channelId, imageType);
}

/**
 * Generate image bytes without making object storage part of broadcast ingestion.
 *
 * When `imageRepresentations` are provided, they are presigned just-in-time
 * and downloaded into bounded Buffers, then passed to the image model as
 * `prompt: { text, images }` (bounded by the active model's input limit).
 * When no usable reference remains, generation degrades to the current
 * text-only prompt.
 */
export async function generateStoryImageAsset(
  description: string,
  options: StoryImageAssetOptions = {},
): Promise<GeneratedStoryImage> {
  const selected = options.imageRepresentations ?? [];
  const { provider, model } = getAiConfiguration().image;
  const limits = getImageReferenceLimits(provider, model);

  let referenceImages: Buffer[] | undefined;
  let referenceHashes: string[] | undefined;
  let candidateCount = 0;

  if (selected.length > 0) {
    candidateCount = selected.length;
    const fetched = await fetchReferenceImages(selected, {
      ...(options.signal ? { signal: options.signal } : {}),
      maxImages: limits.maxImages,
      maxBytesPerImage: limits.maxBytesPerImage,
      allowedMimeTypes: limits.allowedMimeTypes,
    });
    if (fetched.length > 0) {
      referenceImages = fetched.map((f) => f.buffer);
      referenceHashes = fetched.map((f) => f.hash);
    }
  }

  const base64Data = await admitImageProviderWork(
    () => generateStoryImage(description, {
      ...(referenceImages ? { referenceImages, referenceHashes, candidateCount } : {}),
      ...(options.signal ? { abortSignal: options.signal } : {}),
    }),
    options.signal,
  );
  const normalized = base64Data.replace(/^data:image\/[^;]+;base64,/, "");
  const buffer = Buffer.from(normalized, "base64");
  if (buffer.length === 0) throw new Error("Image generator returned empty image data");
  return { buffer, mimeType: "image/jpeg", filename: `story-${generateUUID()}.jpg` };
}

export interface StoryImageBatchItem {
  description: string;
  imageRepresentations?: readonly SelectedImageRepresentation[];
}

export interface StoryImageBatchOptions {
  /** Broadcast abort signal, forwarded through downloads + generation. */
  signal?: AbortSignal;
  /** Max parallel generations (default 4, max 8). Pacing is enforced by the batch budget lane. */
  concurrency?: number;
}

/**
 * Generate 4-8 different story images concurrently without tripping rate limits.
 *
 * Each item resolves references then generates through `admitBatchImageWork`
 * (paced parallelism + shared 429 cooldown). Per-item failures resolve to
 * `undefined` so one bad prompt never fails the batch — callers fall back to
 * an archived visual, same as the single-image path. Results align with input
 * order. Aborts propagate: remaining items resolve `undefined`.
 */
export async function generateStoryImageAssetsBatch(
  items: readonly StoryImageBatchItem[],
  options: StoryImageBatchOptions = {},
): Promise<(GeneratedStoryImage | undefined)[]> {
  const results: (GeneratedStoryImage | undefined)[] = new Array(items.length).fill(undefined);
  if (items.length === 0) return results;
  const rawConcurrency = options.concurrency ?? 4;
  const concurrency = Math.max(1, Math.min(Number.isFinite(rawConcurrency) ? rawConcurrency : 4, 8, items.length));
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index]!;
      try {
        results[index] = await generateOneBatchAsset(item, options.signal);
      } catch (error) {
        if (options.signal?.aborted) return;
        // ponytail: per-item failure is non-fatal by design; caller falls back to archive
        results[index] = undefined;
        void error;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function generateOneBatchAsset(
  item: StoryImageBatchItem,
  signal?: AbortSignal,
): Promise<GeneratedStoryImage> {
  signal?.throwIfAborted();
  const selected = item.imageRepresentations ?? [];
  const { provider, model } = getAiConfiguration().image;
  const limits = getImageReferenceLimits(provider, model);

  let referenceImages: Buffer[] | undefined;
  let referenceHashes: string[] | undefined;
  let candidateCount = 0;

  if (selected.length > 0) {
    candidateCount = selected.length;
    const fetched = await fetchReferenceImages(selected, {
      ...(signal ? { signal } : {}),
      maxImages: limits.maxImages,
      maxBytesPerImage: limits.maxBytesPerImage,
      allowedMimeTypes: limits.allowedMimeTypes,
    });
    if (fetched.length > 0) {
      referenceImages = fetched.map((f) => f.buffer);
      referenceHashes = fetched.map((f) => f.hash);
    }
  }

  const base64Data = await admitBatchImageWork(
    () => generateStoryImage(item.description, {
      ...(referenceImages ? { referenceImages, referenceHashes, candidateCount } : {}),
      ...(signal ? { abortSignal: signal } : {}),
    }),
    signal,
  );
  const normalized = base64Data.replace(/^data:image\/[^;]+;base64,/, "");
  const buffer = Buffer.from(normalized, "base64");
  if (buffer.length === 0) throw new Error("Image generator returned empty image data");
  return { buffer, mimeType: "image/jpeg", filename: `story-${generateUUID()}.jpg` };
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
 * Authenticated fallback read for a persisted archive URL.
 *
 * Plain-HTTPS fetches of `storage.googleapis.com` URLs fail with 403 when the
 * object was stored without a public ACL (the historical default here), which
 * wedges canonical recovery (`hydrateCanonicalSlot`) on the same slot forever.
 * Returns the bytes via the storage SDK when the URL addresses our bucket, or
 * null when GCS is unconfigured / the URL is foreign / the read itself fails.
 */
export async function downloadArchiveBuffer(url: string): Promise<Buffer | null> {
  const bucket = process.env.GOOGLE_CLOUD_BUCKET;
  if (!bucket) return null;
  try {
    const gcs = getGcsImageStorage();
    if (!gcs.ownsPublicUrl(url)) return null;
    return await gcs.downloadToBuffer(url);
  } catch {
    return null;
  }
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

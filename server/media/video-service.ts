import { generateUUID } from "@portalshq/capability-realtime-fanout";
import { GCPStorageManager } from "../storage-manager";
import { logger } from "../logger";
import { generateProviderVideo, type ProviderVideoRequest, getVideoSavingConfig } from "../blocks/ai-provider";

/**
 * Video generation reference types - text, image, or video references
 */
export type VideoReference = 
  | { type: "text"; content: string }
  | { type: "image"; buffer: Buffer; mimeType: string }
  | { type: "video"; buffer: Buffer; mimeType: string }
  | { type: "url"; url: string };

/**
 * Video generation options
 */
export interface VideoGenerationOptions {
  /** Reference material for video generation */
  references?: VideoReference[];
  /** Broadcast abort signal for cancellation */
  signal?: AbortSignal;
  /** Target duration in seconds (optional, provider-dependent) */
  targetDurationSeconds?: number;
  /** Video aspect ratio (default 16:9) */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** Whether to include audio in generated video (default true) */
  includeAudio?: boolean;
}

/**
 * Generated video buffer with metadata
 */
export interface VideoBuffer {
  buffer: Buffer;
  durationSeconds: number;
  extension: string;
  mimeType: string;
  filename: string;
}

/**
 * Video asset ready for queue upload or archival
 */
export interface GeneratedVideo {
  video: VideoBuffer;
  archiveUrl?: string;
}

/**
 * Queue upload asset for video (matches existing QueueUploadAsset pattern)
 */
export interface VideoUploadAsset {
  data: Blob;
  filename: string;
  sha256: string;
}

/**
 * Video source configuration for test/mock module
 */
export interface VideoSourceConfig {
  type: "static" | "url";
  source: string; // file path or URL
  mimeType?: string;
}

/**
 * Generate video from text, image, or video references
 * This is the main production-ready interface for video generation
 */
export async function generateVideo(
  description: string,
  options: VideoGenerationOptions = {}
): Promise<VideoBuffer> {
  const { signal, references = [], targetDurationSeconds, aspectRatio = "16:9", includeAudio = true } = options;

  signal?.throwIfAborted();

  logger.info("[VideoGen] generating video", "video", {
    description: description.slice(0, 100),
    referenceCount: references.length,
    targetDurationSeconds,
    aspectRatio,
    includeAudio,
  });

  try {
    // Convert references to provider format
    const referenceImages: Buffer[] = [];
    const referenceMimeTypes: string[] = [];
    
    for (const ref of references) {
      if (ref.type === "image") {
        referenceImages.push(ref.buffer);
        referenceMimeTypes.push(ref.mimeType);
      } else if (ref.type === "video") {
        // For video references, we could extract first frame, but for now skip
        logger.warn("[VideoGen] video reference not yet supported, skipping", "video");
      } else if (ref.type === "url") {
        // Could download and convert, but for now skip
        logger.warn("[VideoGen] URL reference not yet supported, skipping", "video");
      }
      // Text references are used in the description
    }

    const providerRequest: ProviderVideoRequest = {
      text: description,
      referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      referenceMimeTypes: referenceMimeTypes.length > 0 ? referenceMimeTypes : undefined,
      aspectRatio,
      duration: targetDurationSeconds,
      generateAudio: includeAudio,
      abortSignal: signal,
    };

    const result = await generateProviderVideo(providerRequest);

    logger.info("[VideoGen] video generation completed", "video", {
      sizeBytes: result.videoBuffer.length,
      durationSeconds: result.durationSeconds,
      mimeType: result.mimeType,
      cost: result.cost,
    });

    return {
      buffer: result.videoBuffer,
      durationSeconds: result.durationSeconds,
      extension: mimeTypeToExtension(result.mimeType),
      mimeType: result.mimeType,
      filename: result.filename,
    };
  } catch (error) {
    logger.error("[VideoGen] video generation failed", "video", {
      error: error instanceof Error ? error.message : String(error),
      description: description.slice(0, 100),
    });
    
    // Provide fallback error handling
    if (error instanceof Error) {
      if (error.message.includes("budget exceeded")) {
        throw new Error(`Video generation cost limit reached: ${error.message}`);
      }
      if (error.message.includes("quota exceeded") || error.message.includes("402")) {
        throw new Error(`Video generation quota exceeded. Please check your provider account balance.`);
      }
      if (error.message.includes("Daily video budget exceeded")) {
        throw new Error(`Daily video budget limit reached. Try again tomorrow or increase VIDEO_DAILY_BUDGET_USD.`);
      }
    }
    
    throw error;
  }
}

/**
 * Mock video generation for testing - loads from static file or URL
 */
export async function generateMockVideo(
  config: VideoSourceConfig,
  options: Omit<VideoGenerationOptions, "references"> = {}
): Promise<VideoBuffer> {
  const { signal, targetDurationSeconds, aspectRatio = "16:9" } = options;

  signal?.throwIfAborted();

  logger.info("[VideoGen] generating mock video", "video", {
    type: config.type,
    source: config.source.slice(0, 100),
    targetDurationSeconds,
    aspectRatio,
  });

  let buffer: Buffer;
  let mimeType: string;
  let extension: string;

  if (config.type === "url") {
    const response = await fetch(config.source, { signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch video from URL: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
    
    // Determine MIME type from Content-Type or extension
    mimeType = config.mimeType || response.headers.get("content-type") || "video/mp4";
    extension = mimeTypeToExtension(mimeType);
  } else {
    // Static file
    const fs = await import("node:fs/promises");
    try {
      buffer = await fs.readFile(config.source);
    } catch (error) {
      throw new Error(`Failed to read static video file: ${error instanceof Error ? error.message : String(error)}`);
    }
    mimeType = config.mimeType || "video/mp4";
    extension = mimeTypeToExtension(mimeType);
  }

  if (buffer.length === 0) {
    throw new Error("Video source returned empty buffer");
  }

  // Estimate duration if not provided (rough estimate based on file size)
  const durationSeconds = targetDurationSeconds || estimateVideoDuration(buffer, mimeType);

  const filename = `video-${generateUUID()}.${extension}`;

  logger.info("[VideoGen] mock video generated", "video", {
    sizeBytes: buffer.length,
    durationSeconds,
    mimeType,
    filename,
  });

  return {
    buffer,
    durationSeconds,
    extension,
    mimeType,
    filename,
  };
}

/**
 * Generate video asset with archival support
 */
export async function generateVideoAsset(
  description: string,
  channelId: string,
  videoType: "ambient" | "session" = "ambient",
  options: VideoGenerationOptions = {}
): Promise<GeneratedVideo> {
  const videoBuffer = await generateVideo(description, options);
  
  // Attempt archival based on configuration
  let archiveUrl: string | undefined;
  try {
    archiveUrl = await archiveVideo(videoBuffer, channelId, videoType) || undefined;
  } catch (error) {
    logger.warn("[VideoGen] video archival failed, continuing without archive", "video", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  
  return { video: videoBuffer, archiveUrl };
}

/**
 * Generate mock video asset with archival support
 */
export async function generateMockVideoAsset(
  config: VideoSourceConfig,
  channelId: string,
  videoType: "ambient" | "session" = "ambient",
  options: Omit<VideoGenerationOptions, "references"> = {}
): Promise<GeneratedVideo> {
  const videoBuffer = await generateMockVideo(config, options);
  
  // Attempt archival based on configuration
  let archiveUrl: string | undefined;
  try {
    archiveUrl = await archiveVideo(videoBuffer, channelId, videoType) || undefined;
  } catch (error) {
    logger.warn("[VideoGen] mock video archival failed, continuing without archive", "video", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  
  return { video: videoBuffer, archiveUrl };
}

/**
 * Archive video to storage (GCS or local)
 * Respects video saving configuration - may skip archiving based on mode and settings
 */
export async function archiveVideo(
  video: VideoBuffer,
  channelId: string,
  videoType: "ambient" | "session" = "ambient"
): Promise<string | null> {
  const config = getVideoSavingConfig();
  
  // Check if video should be saved based on mode and configuration
  const shouldSave = videoType === "session" ? config.saveSessionVideos : config.saveAmbientVideos;
  
  if (!shouldSave) {
    logger.info("[VideoGen] skipping video archival based on configuration", "video", {
      videoType,
      saveSessionVideos: config.saveSessionVideos,
      saveAmbientVideos: config.saveAmbientVideos,
    });
    return null;
  }

  const bucket = process.env.GOOGLE_CLOUD_BUCKET;
  
  if (bucket) {
    const gcs = new GCPStorageManager(process.env.GOOGLE_CLOUD_PROJECT || "", bucket);
    const path = buildVideoPath(channelId, videoType, video.filename);
    const base64Data = video.buffer.toString("base64");
    const gsUri = await gcs.uploadBase64Image(base64Data, path, video.mimeType);
    const publicUrl = gcs.getPublicUrl(gsUri);
    
    logger.info("[VideoGen] video archived to GCS", "video", {
      path,
      url: publicUrl,
      sizeBytes: video.buffer.length,
    });
    
    return publicUrl;
  }

  // Fallback to local storage
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  
  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (!publicBaseUrl) {
    throw new Error("PUBLIC_BASE_URL is required when GCS is unavailable");
  }

  const videoDir = path.resolve(process.cwd(), "server/public/video");
  await fs.mkdir(videoDir, { recursive: true });
  
  const localPath = path.join(videoDir, video.filename);
  await fs.writeFile(localPath, video.buffer);
  
  const localUrl = `${publicBaseUrl}/video/${encodeURIComponent(video.filename)}`;
  
  logger.info("[VideoGen] video archived to local storage", "video", {
    path: localPath,
    url: localUrl,
    sizeBytes: video.buffer.length,
  });
  
  return localUrl;
}

/**
 * Download archived video buffer
 */
export async function downloadArchiveVideo(url: string): Promise<Buffer | null> {
  const bucket = process.env.GOOGLE_CLOUD_BUCKET;
  if (!bucket) return null;
  
  try {
    const gcs = new GCPStorageManager(process.env.GOOGLE_CLOUD_PROJECT || "", bucket);
    if (!gcs.ownsPublicUrl(url)) return null;
    return await gcs.downloadToBuffer(url);
  } catch {
    return null;
  }
}

/**
 * Convert video buffer to queue upload asset
 */
export async function videoToUploadAsset(video: VideoBuffer): Promise<VideoUploadAsset> {
  if (video.buffer.length === 0) {
    throw new Error(`Cannot queue empty video: ${video.filename}`);
  }
  
  const crypto = await import("node:crypto");
  return {
    data: new Blob([Uint8Array.from(video.buffer)], { type: video.mimeType }),
    filename: video.filename,
    sha256: crypto.createHash("sha256").update(video.buffer).digest("hex"),
  };
}

/**
 * Build deterministic GCS path for video storage
 */
function buildVideoPath(channelId: string, videoType: "ambient" | "session", filename: string): string {
  const folderMap = { ambient: "ambient", session: "session" };
  return `channels/${channelId}/videos/${folderMap[videoType]}/${filename}`;
}

/**
 * Convert MIME type to file extension
 */
function mimeTypeToExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-msvideo": "avi",
  };
  return mimeToExt[mimeType] || "mp4";
}

/**
 * Estimate video duration from file size (rough approximation)
 * This is a fallback when actual duration metadata is unavailable
 */
function estimateVideoDuration(buffer: Buffer, mimeType: string): number {
  // Rough estimate: 1MB ≈ 1 second at 1Mbps for 720p
  // This is conservative and will be overridden by actual metadata when available
  const sizeMB = buffer.length / (1024 * 1024);
  return Math.max(5, Math.round(sizeMB * 2)); // Minimum 5 seconds
}

/**
 * Validate video buffer format
 */
export function validateVideoBuffer(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 4) return false;
  
  // Check for common video file signatures
  const signatures: Record<string, (number | null)[]> = {
    "video/mp4": [0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70], // ftyp box
    "video/webm": [0x1A, 0x45, 0xDF, 0xA3], // WebM
    "video/quicktime": [0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70], // same as MP4
  };
  
  const sig = signatures[mimeType];
  if (!sig) return true; // Unknown MIME type, assume valid
  
  for (let i = 0; i < sig.length; i++) {
    if (sig[i] !== null && buffer[i] !== sig[i]) return false;
  }
  
  return true;
}

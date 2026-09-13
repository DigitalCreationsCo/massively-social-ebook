import { createGoogleVertex } from "@ai-sdk/google-vertex";
import { createOpenAI } from "@ai-sdk/openai";
import { GoogleGenAI } from "@google/genai";
import { InferenceClient } from "@huggingface/inference";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpencode } from "ai-sdk-provider-opencode-sdk";
import { generateImage, type EmbeddingModel, type ImageModel, type LanguageModel } from "ai";
import { fal } from "@fal-ai/client";

/** Providers that can be selected through the AI_*_PROVIDER environment variables. */
export type AiProvider = "google" | "openai" | "opencode" | "huggingface" | "openrouter" | "fal";
type AiCapability = "text" | "image" | "embedding" | "video";

const DEFAULT_MODELS: Record<AiProvider, Record<AiCapability, string | undefined>> = {
  google: {
    text: "gemini-3.7-flash",
    image: "gemini-2.5-flash-image",
    embedding: "gemini-embedding-001",
    video: undefined,
  },
  openai: {
    text: "gpt-5.6-luna",
    image: "gpt-image-1.5",
    embedding: "text-embedding-3-small",
    video: undefined,
  },
  // OpenCode's community AI SDK provider currently exposes language models only.
  opencode: {
    text: "opencode/ling-3.0-flash-fin-free",
    image: undefined,
    embedding: undefined,
    video: undefined,
  },
  huggingface: {
    text: undefined,
    image: "black-forest-labs/FLUX.2-dev",
    embedding: undefined,
    video: undefined,
  },
  openrouter: {
    text: "minimax/minimax-m3:free",
    image: "meta/muse-image",
    embedding: undefined,
    video: "google/veo-3.1",
  },
  fal: {
    text: undefined,
    image: undefined,
    embedding: undefined,
    video: "fal-ai/veo3.1",
  },
};

function requireEnvironmentVariable(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }

  throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
}

function configuredProvider(capability: AiCapability): AiProvider {
  const configuredValue =
    process.env[`AI_${capability.toUpperCase()}_PROVIDER`] ??
    process.env.AI_PROVIDER;
  const configured = (configuredValue || "google").trim().toLowerCase();

  if (configured === "gemini") return "google";
  if (configured === "hf") return "huggingface";
  if (
    configured === "google" || configured === "openai" || configured === "opencode" ||
    configured === "huggingface" || configured === "openrouter" || configured === "fal"
  ) {
    return configured;
  }

  throw new Error(
    `Unsupported AI provider "${configured}". Use google, openai, opencode, huggingface, openrouter, or fal.`,
  );
}

function configuredModel(capability: AiCapability, provider: AiProvider): string {
  const configuredModel =
    process.env[`AI_${capability.toUpperCase()}_MODEL`] ??
    (capability === "text" ? process.env.AI_MODEL : undefined);
  const model =
    configuredModel?.trim() ||
    DEFAULT_MODELS[provider][capability];

  if (!model) {
    throw new Error(
      `AI ${capability} generation is not supported by the ${provider} provider. ` +
        `Choose a supported AI_${capability.toUpperCase()}_PROVIDER.`,
    );
  }

  return model;
}

function googleProvider() {
  // GEMINI_API_KEY is retained as a backwards-compatible alias.
  return createGoogleVertex({
    project: requireEnvironmentVariable("GOOGLE_CLOUD_PROJECT_ID"),
  });
}

function openaiProvider() {
  return createOpenAI({ apiKey: requireEnvironmentVariable("OPENAI_API_KEY") });
}

function openrouterProvider() {
  return createOpenRouter({ apiKey: requireEnvironmentVariable("OPENROUTER_API_KEY") });
}

function opencodeProvider() {
  const timeout = Number.parseInt(process.env.OPENCODE_SERVER_TIMEOUT_MS ?? "10000", 10);
  return createOpencode(
    // {
    // baseUrl: process.env.OPENCODE_BASE_URL,
    // autoStartServer: process.env.OPENCODE_AUTO_START_SERVER !== "false",
    // serverTimeout: Number.isFinite(timeout) ? timeout : 10_000,
    // }
  );
}

/** Returns the language model selected by AI_TEXT_PROVIDER and AI_TEXT_MODEL. */
export function getLanguageModel(): LanguageModel {
  const provider = configuredProvider("text");
  const model = configuredModel("text", provider);

  switch (provider) {
    case "google":
      return googleProvider()(model);
    case "openai":
      return openaiProvider()(model);
    case "opencode":
      return opencodeProvider()(model);
    case "huggingface":
      throw new Error("Hugging Face is currently available only for AI_IMAGE_PROVIDER.");
    case "openrouter":
      return openrouterProvider()(model);
  }
}

function getHuggingFaceImageClient(): InferenceClient {
  return new InferenceClient(requireEnvironmentVariable("HF_TOKEN"));
}

function getGoogleGenAiImageClient(): GoogleGenAI {
  return new GoogleGenAI({
    vertexai: true,
    project: requireEnvironmentVariable("GOOGLE_CLOUD_PROJECT_ID", "GOOGLE_CLOUD_PROJECT"),
    location: process.env.GOOGLE_VERTEX_LOCATION?.trim() || "global",
  });
}

/**
 * OpenRouter dedicated Images API (`POST /api/v1/images`).
 *
 * The installed `@openrouter/ai-sdk-provider` (v3) routes `imageModel()` through
 * `/chat/completions`, which Images-API-only models like `meta/muse-image` do not
 * serve — so OpenRouter image generation goes through this direct client instead
 * (same pattern as the Hugging Face direct client below).
 */
const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";

function sniffImageMime(buffer: Uint8Array | Buffer): string | undefined {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return "image/webp";
  return undefined;
}

function resolveReferenceMimeType(image: NonNullable<ProviderImageRequest["referenceImages"]>[number], explicit?: string): string {
  if (explicit) {
    const t = explicit.trim().toLowerCase();
    if (t) return t;
  }
  if (typeof image === "string") {
    const m = image.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
    if (m) return m[1]!.toLowerCase();
    return "image/png";
  }
  const bytes = image instanceof ArrayBuffer ? new Uint8Array(image) : image as Uint8Array | Buffer;
  return sniffImageMime(bytes as Uint8Array) ?? "image/png";
}

function openRouterReferenceDataUrl(image: NonNullable<ProviderImageRequest["referenceImages"]>[number], mimeType?: string): string {
  if (typeof image === "string") {
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(image)) return image;
    return `data:${mimeType ?? "image/png"};base64,${image}`;
  }
  const mime = mimeType ?? sniffImageMime(Buffer.from(image instanceof ArrayBuffer ? new Uint8Array(image) : image as Uint8Array)) ?? "image/png";
  return `data:${mime};base64,${Buffer.from(image instanceof ArrayBuffer ? new Uint8Array(image) : image).toString("base64")}`;
}

async function generateOpenRouterImage(
  text: string,
  images: NonNullable<ProviderImageRequest["referenceImages"]>,
  model: string,
  abortSignal?: AbortSignal,
  mimeTypes?: string[],
): Promise<string | undefined> {
  const response = await fetch(OPENROUTER_IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnvironmentVariable("OPENROUTER_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: text,
      aspect_ratio: "16:9",
      output_format: "jpeg",
      ...(images.length > 0
        ? {
          input_references: images.slice(0, 16).map((image, i) => ({
            type: "image_url",
            image_url: { url: openRouterReferenceDataUrl(image, mimeTypes?.[i] ?? (typeof image === "string" ? undefined : sniffImageMime(Buffer.from(image instanceof ArrayBuffer ? new Uint8Array(image) : image as Uint8Array)) ?? undefined)) },
          })),
        }
        : {}),
    }),
    ...(abortSignal ? { signal: abortSignal } : {}),
  });
  if (!response.ok) {
    const snippet = await response.text().then((t) => t.slice(0, 200)).catch(() => "");
    throw new Error(`OpenRouter image request failed (${response.status}): ${snippet}`);
  }
  const json = (await response.json()) as { data?: Array<{ b64_json?: unknown }> };
  const b64 = json?.data?.[0]?.b64_json;
  return typeof b64 === "string" ? b64.replace(/^data:image\/[^;]+;base64,/, "") : undefined;
}

export interface ProviderImageRequest {
  text: string;
  referenceImages?: Array<Buffer | Uint8Array | ArrayBuffer | string>;
  /** Per-image MIME types parallel to referenceImages (e.g. image/jpeg for previousBlock). */
  referenceMimeTypes?: string[];
  abortSignal?: AbortSignal;
}

export interface ProviderVideoRequest {
  text: string;
  referenceImages?: Array<Buffer | Uint8Array | ArrayBuffer | string>;
  referenceMimeTypes?: string[];
  aspectRatio?: "16:9" | "9:16" | "1:1";
  duration?: number; // in seconds
  resolution?: "720p" | "1080p";
  generateAudio?: boolean;
  abortSignal?: AbortSignal;
}

export interface ProviderVideoResponse {
  videoBuffer: Buffer;
  durationSeconds: number;
  mimeType: string;
  filename: string;
  cost?: number; // Cost in USD for cost tracking
}

function referenceImageBase64(image: NonNullable<ProviderImageRequest["referenceImages"]>[number]): string {
  if (typeof image === "string") return image.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  return Buffer.from(image instanceof ArrayBuffer ? new Uint8Array(image) : image).toString("base64");
}

/** Executes image generation through the selected provider. */
export async function generateProviderImage(request: ProviderImageRequest): Promise<string | undefined> {
  const { provider, model } = getAiConfiguration().image;
  const images = request.referenceImages ?? [];
  const mimes = request.referenceMimeTypes ?? [];

  if (provider === "google") {
    const response = await getGoogleGenAiImageClient().models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [
          { text: request.text },
          ...images.map((image, i) => ({
            inlineData: { mimeType: resolveReferenceMimeType(image, mimes[i]), data: referenceImageBase64(image) },
          })),
        ],
      }],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "16:9" },
        ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
      },
    });
    return response.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .find((part) => part.inlineData?.data)?.inlineData?.data;
  }

  if (provider === "openrouter") {
    return generateOpenRouterImage(request.text, images, model, request.abortSignal, mimes);
  }

  if (provider === "huggingface") {
    const mime = images[0] ? resolveReferenceMimeType(images[0], mimes[0]) : undefined;
    const image = await getHuggingFaceImageClient().imageTextToImage(
      {
        provider: "fal-ai",
        model,
        ...(images[0] ? { inputs: new Blob([images[0] as BlobPart], mime ? { type: mime } : undefined) } : {}),
        parameters: {
          prompt: request.text,
          target_size: { width: 1536, height: 864 },
        },
      },
      {
        retry_on_error: false,
        ...(request.abortSignal ? { signal: request.abortSignal } : {}),
      },
    );
    return Buffer.from(await image.arrayBuffer()).toString("base64");
  }

  const prompt = images.length > 0 ? { text: request.text, images } : request.text;
  const response = await generateImage({
    model: getImageModel(),
    prompt,
    n: 1,
    aspectRatio: "16:9",
    maxRetries: 0,
    ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
  });
  return response.image?.base64;
}

/** Returns an image model selected by AI_IMAGE_PROVIDER and AI_IMAGE_MODEL. */
export function getImageModel(): ImageModel {
  const provider = configuredProvider("image");
  if (provider === "opencode" || provider === "huggingface" || provider === "openrouter") {
    throw new Error(
      provider === "huggingface"
        ? "Hugging Face uses its direct inference client. Use generateStoryImage instead of getImageModel."
        : provider === "openrouter"
          ? "OpenRouter uses its direct Images API client. Use generateStoryImage instead of getImageModel."
          : "OpenCode does not expose an AI SDK image model. Set AI_IMAGE_PROVIDER to google, openai, huggingface, or openrouter.",
    );
  }

  const model = configuredModel("image", provider);

  switch (provider) {
    case "google":
      return googleProvider().image(model);
    case "openai":
      return openaiProvider().image(model);
  }
}

/** Returns an embedding model selected by AI_EMBEDDING_PROVIDER and AI_EMBEDDING_MODEL. */
export function getEmbeddingModel(): EmbeddingModel {
  const provider = configuredProvider("embedding");
  if (provider === "opencode" || provider === "huggingface") {
    throw new Error(
      "OpenCode does not expose an AI SDK embedding model. Set AI_EMBEDDING_PROVIDER to google or openai.",
    );
  }

  const model = configuredModel("embedding", provider);

  switch (provider) {
    case "google":
      return googleProvider().embeddingModel(model);
    case "openai":
      return openaiProvider().embedding(model);
    case "openrouter":
      return openrouterProvider().embedding(model);
  }
}

/** The active resolved configuration, useful for diagnostics and tests. */
export function getAiConfiguration() {
  const textProvider = configuredProvider("text");
  const imageProvider = configuredProvider("image");
  const embeddingProvider = configuredProvider("embedding");
  const videoProvider = configuredProvider("video");

  return {
    text: { provider: textProvider, model: configuredModel("text", textProvider) },
    image: { provider: imageProvider, model: configuredModel("image", imageProvider) },
    embedding: {
      provider: embeddingProvider,
      model: configuredModel("embedding", embeddingProvider),
    },
    video: { provider: videoProvider, model: configuredModel("video", videoProvider) },
  };
}

/**
 * Cost control configuration for video generation
 */
interface VideoCostControl {
  dailyBudgetUsd?: number;
  spentTodayUsd: number;
  dailyResetAt: number; // Unix timestamp
}

const costControlState: VideoCostControl = {
  dailyBudgetUsd: Number(process.env.VIDEO_DAILY_BUDGET_USD || "10"),
  spentTodayUsd: 0,
  dailyResetAt: getDailyResetTimestamp(),
};

/**
 * Video saving configuration
 * Videos are only saved for session mode by default, not for ambient mode
 */
export interface VideoSavingConfig {
  saveSessionVideos: boolean; // Save videos generated in session mode
  saveAmbientVideos: boolean; // Save videos generated in ambient mode
}

export function getVideoSavingConfig(): VideoSavingConfig {
  return {
    saveSessionVideos: process.env.VIDEO_SAVE_SESSION === "true" || process.env.VIDEO_SAVE_SESSION === undefined,
    saveAmbientVideos: process.env.VIDEO_SAVE_AMBIENT === "true" || false, // Default false for ambient
  };
}

function getDailyResetTimestamp(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.getTime();
}

function resetDailyCostIfNeeded(): void {
  const now = Date.now();
  if (now >= costControlState.dailyResetAt) {
    costControlState.spentTodayUsd = 0;
    costControlState.dailyResetAt = getDailyResetTimestamp();
  }
}

function checkDailyBudget(costUsd: number): boolean {
  resetDailyCostIfNeeded();
  if (costControlState.dailyBudgetUsd === undefined) return true; // No limit
  
  const remainingBudget = costControlState.dailyBudgetUsd - costControlState.spentTodayUsd;
  if (remainingBudget < costUsd) {
    return false;
  }
  
  costControlState.spentTodayUsd += costUsd;
  return true;
}

/**
 * Get estimated cost for video generation based on provider and duration
 */
function estimateVideoCost(provider: AiProvider, durationSeconds: number, resolution: string): number {
  const costPerSecond: Record<AiProvider, Record<string, number>> = {
    openrouter: {
      "720p": 0.50, // OpenRouter pricing per second at 720p
      "1080p": 0.75, // OpenRouter pricing per second at 1080p
    },
    fal: {
      "720p": 0.03, // Fal.ai estimated cost per second at 720p
      "1080p": 0.05, // Fal.ai estimated cost per second at 1080p
    },
    google: { "720p": 0, "1080p": 0 }, // Google Vertex pricing varies
    openai: { "720p": 0, "1080p": 0 }, // OpenAI pricing varies
    opencode: { "720p": 0, "1080p": 0 },
    huggingface: { "720p": 0, "1080p": 0 },
  };
  
  const providerCosts = costPerSecond[provider] || costPerSecond.google;
  const resolutionCost = providerCosts[resolution] || providerCosts["720p"] || 0.50;
  
  return durationSeconds * resolutionCost;
}

/**
 * OpenRouter video generation using dedicated video API
 */
async function generateOpenRouterVideo(request: ProviderVideoRequest): Promise<ProviderVideoResponse> {
  const { model } = getAiConfiguration().video;
  const duration = request.duration ?? 5; // Default 5 seconds for cost control
  const resolution = request.resolution ?? "720p"; // Default 720p for cost control
  const aspectRatio = request.aspectRatio ?? "16:9";
  
  const estimatedCost = estimateVideoCost("openrouter", duration, resolution);
  if (!checkDailyBudget(estimatedCost)) {
    throw new Error(`Daily video budget exceeded. Estimated cost: $${estimatedCost.toFixed(2)}`);
  }
  
  const requestBody = {
    model,
    prompt: request.text,
    aspect_ratio: aspectRatio,
    duration: duration,
    resolution,
    generate_audio: request.generateAudio ?? true,
    ...(request.referenceImages && request.referenceImages.length > 0 ? {
      input_references: request.referenceImages.slice(0, 16).map((image, i) => ({
        type: "image_url",
        image_url: { 
          url: openRouterReferenceDataUrl(image, request.referenceMimeTypes?.[i])
        },
      })),
    } : {}),
  };
  
  const response = await fetch("https://openrouter.ai/api/v1/videos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnvironmentVariable("OPENROUTER_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
    ...(request.abortSignal ? { signal: request.abortSignal } : {}),
  });
  
  if (!response.ok) {
    const errorText = await response.text().then((t) => t.slice(0, 200)).catch(() => "");
    throw new Error(`OpenRouter video generation failed (${response.status}): ${errorText}`);
  }
  
  const json = await response.json() as { 
    data?: Array<{ 
      video?: { 
        url?: string;
        b64_json?: string;
      };
      id?: string;
      status?: string;
    }> 
  };
  
  const result = json.data?.[0];
  if (!result) {
    throw new Error("OpenRouter video generation returned no result");
  }
  
  // Handle async video generation - return polling URL
  if (result.status === "processing" || result.status === "pending") {
    throw new Error(`Video generation started but not complete. Job ID: ${result.id}. Polling not yet implemented.`);
  }
  
  // Handle completed video generation
  const videoUrl = result.video?.url;
  if (!videoUrl) {
    throw new Error("OpenRouter video generation did not return a video URL");
  }
  
  // Download the video
  const videoResponse = await fetch(videoUrl, {
    ...(request.abortSignal ? { signal: request.abortSignal } : {}),
  });
  
  if (!videoResponse.ok) {
    throw new Error(`Failed to download video from OpenRouter (${videoResponse.status})`);
  }
  
  const buffer = Buffer.from(await videoResponse.arrayBuffer());
  const filename = `video-${result.id}.mp4`;
  
  return {
    videoBuffer: buffer,
    durationSeconds: duration,
    mimeType: "video/mp4",
    filename,
    cost: estimatedCost,
  };
}

/**
 * Fal.ai video generation using their serverless client
 */
async function generateFalVideo(request: ProviderVideoRequest): Promise<ProviderVideoResponse> {
  const { model } = getAiConfiguration().video;
  const duration = request.duration ?? 5; // Default 5 seconds for cost control
  const resolution = request.resolution ?? "720p"; // Default 720p for cost control
  const aspectRatio = request.aspectRatio ?? "16:9";
  
  const estimatedCost = estimateVideoCost("fal", duration, resolution);
  if (!checkDailyBudget(estimatedCost)) {
    throw new Error(`Daily video budget exceeded. Estimated cost: $${estimatedCost.toFixed(2)}`);
  }
  
  // Map aspect ratio to Fal.ai format
  const falAspectRatio = aspectRatio === "9:16" ? "9:16" : "16:9";
  
  // Map duration to Fal.ai format
  const falDuration = `${duration}s`;
  
  // Map resolution to Fal.ai format
  const falResolution = resolution === "1080p" ? "1080p" : "720p";
  
  let falModelId: string;
  if (model === "fal-ai/veo3.1") {
    falModelId = "fal-ai/veo3.1";
  } else if (model === "fal-ai/kling-video/v3/standard/text-to-video") {
    falModelId = "fal-ai/kling-video/v3/standard/text-to-video";
  } else {
    falModelId = model; // Use as-is if custom model
  }
  
  try {
    const result = await fal.run(falModelId, {
      input: {
        prompt: request.text,
        aspect_ratio: falAspectRatio,
        duration: falDuration,
        resolution: falResolution,
        generate_audio: request.generateAudio ?? true,
        ...(request.referenceImages && request.referenceImages.length > 0 ? {
          image_url: openRouterReferenceDataUrl(request.referenceImages[0]),
        } : {}),
      },
      ...(request.abortSignal ? { httpRequest: { signal: request.abortSignal } } : {}),
    });
    
    if (!result.video) {
      throw new Error("Fal.ai video generation did not return a video");
    }
    
    // Download the video from Fal.ai's CDN
    const videoResponse = await fetch(result.video.url, {
      ...(request.abortSignal ? { signal: request.abortSignal } : {}),
    });
    
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video from Fal.ai (${videoResponse.status})`);
    }
    
    const buffer = Buffer.from(await videoResponse.arrayBuffer());
    const filename = `video-${falModelId.replace(/\//g, "-")}-${Date.now()}.mp4`;
    
    return {
      videoBuffer: buffer,
      durationSeconds: duration,
      mimeType: "video/mp4",
      filename,
      cost: estimatedCost,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("402")) {
      throw new Error("Fal.ai quota exceeded or payment required. Check your Fal.ai account balance.");
    }
    throw error;
  }
}

/**
 * Main video generation function that routes to the appropriate provider
 */
export async function generateProviderVideo(request: ProviderVideoRequest): Promise<ProviderVideoResponse> {
  const { provider } = getAiConfiguration().video;
  
  resetDailyCostIfNeeded();
  
  switch (provider) {
    case "openrouter":
      return generateOpenRouterVideo(request);
    case "fal":
      return generateFalVideo(request);
    case "google":
    case "openai":
    case "opencode":
    case "huggingface":
      throw new Error(`Video generation not yet supported by ${provider} provider. Use openrouter or fal for video generation.`);
    default:
      throw new Error(`Unknown video provider: ${provider}`);
  }
}

/**
 * Get current cost control state for monitoring
 */
export function getVideoCostControlState(): VideoCostControlState {
  resetDailyCostIfNeeded();
  return {
    dailyBudgetUsd: costControlState.dailyBudgetUsd,
    spentTodayUsd: costControlState.spentTodayUsd,
    remainingBudgetUsd: costControlState.dailyBudgetUsd !== undefined 
      ? Math.max(0, costControlState.dailyBudgetUsd - costControlState.spentTodayUsd)
      : undefined,
    dailyResetAt: costControlState.dailyResetAt,
  };
}

export interface VideoCostControlState {
  dailyBudgetUsd?: number;
  spentTodayUsd: number;
  remainingBudgetUsd?: number;
  dailyResetAt: number;
}

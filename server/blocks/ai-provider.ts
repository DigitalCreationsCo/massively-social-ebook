import { createGoogleVertex } from "@ai-sdk/google-vertex";
import { createOpenAI } from "@ai-sdk/openai";
import { GoogleGenAI } from "@google/genai";
import { InferenceClient } from "@huggingface/inference";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpencode } from "ai-sdk-provider-opencode-sdk";
import { generateImage, type EmbeddingModel, type ImageModel, type LanguageModel } from "ai";
import { fal } from "@fal-ai/client";
import { logger } from "../logger";
import {
  estimateVideoCost as estimateVideoCostFromConfig,
  getVideoConfig,
  normalizeAspectRatio,
  snapDurationForProvider,
  snapFalDurationString,
  type VideoProviderName,
} from "../media/video-config";

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
  // Video is optional: google/openai/etc. have no video model, and callers
  // that only need text/image must not throw because video is unconfigured.
  let videoProvider: AiProvider = "openrouter";
  let videoModel: string | undefined;
  try {
    videoProvider = configuredProvider("video");
    videoModel = configuredModel("video", videoProvider);
  } catch {
    videoProvider = (process.env.AI_VIDEO_PROVIDER?.trim().toLowerCase() === "fal" ? "fal" : "openrouter") as AiProvider;
    videoModel = videoProvider === "fal" ? "fal-ai/veo3.1" : "google/veo-3.1";
  }

  return {
    text: { provider: textProvider, model: configuredModel("text", textProvider) },
    image: { provider: imageProvider, model: configuredModel("image", imageProvider) },
    embedding: {
      provider: embeddingProvider,
      model: configuredModel("embedding", embeddingProvider),
    },
    video: { provider: videoProvider, model: videoModel as string },
  };
}

/**
 * Cost control state for video generation (spend is in-memory per process).
 */
interface VideoCostControl {
  spentTodayUsd: number;
  dailyResetAt: number; // Unix timestamp
}

const costControlState: VideoCostControl = {
  spentTodayUsd: 0,
  dailyResetAt: getDailyResetTimestamp(),
};

/** Test-only reset (budgets read live from env otherwise). */
export function __resetVideoCostForTests(): void {
  costControlState.spentTodayUsd = 0;
  costControlState.dailyResetAt = getDailyResetTimestamp();
}

/**
 * Video saving configuration
 * Videos are only saved for session mode by default, not for ambient mode
 */
export interface VideoSavingConfig {
  saveSessionVideos: boolean; // Save videos generated in session mode
  saveAmbientVideos: boolean; // Save videos generated in ambient mode
}

export function getVideoSavingConfig(): VideoSavingConfig {
  const cfg = getVideoConfig();
  return {
    saveSessionVideos: cfg.saveSessionVideos,
    saveAmbientVideos: cfg.saveAmbientVideos,
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
  const budget = getVideoConfig().dailyBudgetUsd;
  if (budget === undefined) return true; // No limit
  if (budget - costControlState.spentTodayUsd < costUsd) return false;
  costControlState.spentTodayUsd += costUsd;
  return true;
}

/**
 * Estimated cost; prefer provider-reported usage.cost when available.
 * Env overrides (VIDEO_COST_<PROVIDER>_<RES>) let ops align with real billing.
 */
function estimateVideoCost(provider: VideoProviderName, durationSeconds: number, resolution: string): number {
  return estimateVideoCostFromConfig(provider, durationSeconds, resolution);
}

// ── Typed errors ─────────────────────────────────────────────────────────────

export type VideoErrorCode =
  | "budget_exceeded"
  | "quota_exceeded"
  | "rate_limited"
  | "timeout"
  | "aborted"
  | "invalid_request"
  | "unauthorized"
  | "provider_unavailable"
  | "generation_failed";

export class VideoProviderError extends Error {
  code: VideoErrorCode;
  status?: number;
  retryable: boolean;
  constructor(code: VideoErrorCode, message: string, opts: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = "VideoProviderError";
    this.code = code;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
  }
}

function throwForStatus(provider: string, status: number, snippet: string): never {
  const msg = `${provider} video request failed (${status}): ${snippet}`;
  if (status === 400) throw new VideoProviderError("invalid_request", msg, { status });
  if (status === 401 || status === 403) throw new VideoProviderError("unauthorized", msg, { status });
  if (status === 402) throw new VideoProviderError("quota_exceeded", `${provider} quota exceeded or payment required. Check account balance.`, { status });
  if (status === 429) throw new VideoProviderError("rate_limited", msg, { status, retryable: true });
  if (status >= 500) throw new VideoProviderError("provider_unavailable", msg, { status, retryable: true });
  throw new VideoProviderError("generation_failed", msg, { status });
}

// ── Fetch with timeout + retry + backoff ─────────────────────────────────────

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new VideoProviderError("aborted", "aborted", {}));
    const t = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); cleanup(); reject(signal!.reason ?? new VideoProviderError("aborted", "aborted", {})); };
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    signal?.addEventListener("abort", onAbort, { once: true });
    (t as unknown as { unref?: () => void }).unref?.();
  });
}

function combineSignals(outer?: AbortSignal, timeoutMs?: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort(outer?.reason);
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener("abort", onOuterAbort, { once: true });
  }
  if (timeoutMs !== undefined) {
    timer = setTimeout(() => controller.abort(new VideoProviderError("timeout", `video request timed out after ${timeoutMs}ms`, { retryable: true })), timeoutMs);
    (timer as unknown as { unref?: () => void }).unref?.();
  }
  return { signal: controller.signal, cancel: () => { clearTimeout(timer); outer?.removeEventListener("abort", onOuterAbort); } };
}

function retryDelay(attempt: number, baseMs: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs)) {
    return Math.min(retryAfterMs, 60_000);
  }
  return Math.min(30_000, baseMs * 2 ** attempt + Math.random() * 250);
}

async function fetchWithRetry(
  url: string,
  init: RequestInit & { timeoutMs?: number; maxRetries?: number; retryBaseMs?: number },
): Promise<Response> {
  const { timeoutMs = 60_000, maxRetries = 2, retryBaseMs = 1_000, ...fetchInit } = init;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const { signal, cancel } = combineSignals(fetchInit.signal as AbortSignal | undefined, timeoutMs);
    try {
      const res = await fetch(url, { ...fetchInit, signal });
      cancel();
      if (res.ok) return res;
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const retryAfter = res.headers?.get?.("retry-after");
        const retryAfterMs = retryAfter ? Number(retryAfter) * 1_000 : undefined;
        await res.arrayBuffer().catch(() => undefined);
        await sleep(retryDelay(attempt, retryBaseMs, retryAfterMs), fetchInit.signal as AbortSignal | undefined);
        continue;
      }
      return res; // non-retryable status: caller maps to typed error
    } catch (cause) {
      cancel();
      lastError = cause;
      if ((cause as Error)?.name === "AbortError" || (cause as VideoProviderError)?.code === "aborted") throw cause;
      const isTimeout = cause instanceof VideoProviderError && cause.code === "timeout";
      if (attempt < maxRetries && (isTimeout || cause instanceof TypeError)) {
        await sleep(retryDelay(attempt, retryBaseMs), fetchInit.signal as AbortSignal | undefined).catch(() => { throw cause; });
        continue;
      }
      throw cause;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ── Metrics (in-memory, surfaced via logs + getter) ──────────────────────────

export interface VideoMetrics {
  attempts: number;
  successes: number;
  failuresByCode: Record<string, number>;
  totalCostUsd: number;
  totalLatencyMs: number;
  lastLatencyMs?: number;
  lastErrorCode?: string;
  byProvider: Record<string, { attempts: number; successes: number; totalLatencyMs: number }>;
}

const videoMetrics: VideoMetrics = {
  attempts: 0,
  successes: 0,
  failuresByCode: {},
  totalCostUsd: 0,
  totalLatencyMs: 0,
  byProvider: {},
};

function recordVideoMetric(provider: string, latencyMs: number, ok: boolean, cost?: number, code?: string): void {
  videoMetrics.attempts += 1;
  videoMetrics.totalLatencyMs += latencyMs;
  videoMetrics.lastLatencyMs = latencyMs;
  const p = (videoMetrics.byProvider[provider] ??= { attempts: 0, successes: 0, totalLatencyMs: 0 });
  p.attempts += 1;
  p.totalLatencyMs += latencyMs;
  if (ok) {
    videoMetrics.successes += 1;
    p.successes += 1;
    if (cost) videoMetrics.totalCostUsd += cost;
  } else {
    const key = code ?? "unknown";
    videoMetrics.failuresByCode[key] = (videoMetrics.failuresByCode[key] ?? 0) + 1;
    videoMetrics.lastErrorCode = key;
  }
}

export function getVideoMetrics(): VideoMetrics {
  return JSON.parse(JSON.stringify(videoMetrics)) as VideoMetrics;
}

/** Test-only reset. */
export function __resetVideoMetricsForTests(): void {
  videoMetrics.attempts = 0;
  videoMetrics.successes = 0;
  videoMetrics.failuresByCode = {};
  videoMetrics.totalCostUsd = 0;
  videoMetrics.totalLatencyMs = 0;
  delete videoMetrics.lastLatencyMs;
  delete videoMetrics.lastErrorCode;
  videoMetrics.byProvider = {};
}

// ── OpenRouter (async: submit → poll → download) ─────────────────────────────

const OPENROUTER_VIDEOS_URL = "https://openrouter.ai/api/v1/videos";

interface OpenRouterJob {
  id: string;
  polling_url: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired" | string;
  generation_id?: string;
  unsigned_urls?: string[];
  usage?: { cost?: number };
  error?: string;
}

function resolvePollingUrl(pollingUrl: string): string {
  if (/^https?:\/\//i.test(pollingUrl)) return pollingUrl;
  return `https://openrouter.ai${pollingUrl.startsWith("/") ? "" : "/"}${pollingUrl}`;
}

async function pollOpenRouterJob(
  job: OpenRouterJob,
  apiKey: string,
  opts: { signal?: AbortSignal; intervalMs: number; timeoutMs: number },
): Promise<OpenRouterJob> {
  const url = resolvePollingUrl(job.polling_url);
  const started = Date.now();
  let current = job;
  for (;;) {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new VideoProviderError("aborted", "video poll aborted");
    if (current.status === "completed" || current.status === "failed" || current.status === "cancelled" || current.status === "expired") {
      return current;
    }
    if (Date.now() - started > opts.timeoutMs) {
      throw new VideoProviderError("timeout", `OpenRouter video job ${current.id} did not complete within ${opts.timeoutMs}ms`, { retryable: false });
    }
    await sleep(opts.intervalMs, opts.signal);
    const res = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: opts.signal,
      timeoutMs: 30_000,
      maxRetries: 2,
      retryBaseMs: 1_000,
    });
    if (!res.ok) {
      const snippet = await res.text().then((t) => t.slice(0, 300)).catch(() => "");
      // Poll reads are safe to keep retrying on transient errors; surface the rest.
      if (res.status === 429 || res.status >= 500) {
        logger.warn("[VideoGen] OpenRouter poll transient failure, continuing", "video", { status: res.status, jobId: current.id });
        continue;
      }
      throwForStatus("OpenRouter", res.status, snippet);
    }
    current = (await res.json()) as OpenRouterJob;
  }
}

async function downloadBuffer(url: string, signal: AbortSignal | undefined, timeoutMs: number, maxRetries: number, retryBaseMs: number): Promise<Buffer> {
  const res = await fetchWithRetry(url, { signal, timeoutMs, maxRetries, retryBaseMs });
  if (!res.ok) {
    throw new VideoProviderError("generation_failed", `video download failed (${res.status})`, { status: res.status, retryable: res.status >= 500 });
  }
  return Buffer.from(await res.arrayBuffer());
}

async function generateOpenRouterVideo(request: ProviderVideoRequest): Promise<ProviderVideoResponse> {
  const started = Date.now();
  const cfg = getVideoConfig();
  const { model } = getAiConfiguration().video;
  const duration = snapDurationForProvider(request.duration ?? cfg.durationSeconds, "openrouter");
  const resolution = request.resolution ?? cfg.resolution;
  const aspectRatio = normalizeAspectRatio(request.aspectRatio ?? cfg.aspectRatio, "16:9");

  const estimatedCost = estimateVideoCost("openrouter", duration, resolution);
  if (!checkDailyBudget(estimatedCost)) {
    const err = new VideoProviderError("budget_exceeded", `Daily video budget exceeded. Estimated cost: $${estimatedCost.toFixed(2)}`);
    recordVideoMetric("openrouter", Date.now() - started, false, undefined, err.code);
    throw err;
  }

  const apiKey = requireEnvironmentVariable("OPENROUTER_API_KEY");
  try {
    const submit = await fetchWithRetry(OPENROUTER_VIDEOS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: request.text,
        aspect_ratio: aspectRatio,
        duration,
        resolution,
        generate_audio: request.generateAudio ?? cfg.generateAudio,
        ...(request.referenceImages?.length
          ? {
            input_references: request.referenceImages.slice(0, 16).map((image, i) => ({
              type: "image_url",
              image_url: { url: openRouterReferenceDataUrl(image, request.referenceMimeTypes?.[i]) },
            })),
          }
          : {}),
      }),
      signal: request.abortSignal,
      timeoutMs: 60_000,
      maxRetries: cfg.maxRetries,
      retryBaseMs: cfg.retryBaseMs,
    });
    if (!submit.ok) {
      const snippet = await submit.text().then((t) => t.slice(0, 300)).catch(() => "");
      throwForStatus("OpenRouter", submit.status, snippet);
    }
    const job = (await submit.json()) as OpenRouterJob;
    if (!job?.id || !job?.polling_url) throw new VideoProviderError("generation_failed", "OpenRouter video submit returned no job id/polling_url");

    const final = await pollOpenRouterJob(job, apiKey, {
      signal: request.abortSignal,
      intervalMs: cfg.pollIntervalMs,
      timeoutMs: Math.min(cfg.pollTimeoutMs, cfg.timeoutMs),
    });
    if (final.status !== "completed") {
      throw new VideoProviderError("generation_failed", `OpenRouter video job ${final.id} ended with status ${final.status}${final.error ? `: ${final.error}` : ""}`);
    }
    const cost = final.usage?.cost ?? estimatedCost;
    const direct = final.unsigned_urls?.[0];
    let buffer: Buffer | undefined;
    if (direct) {
      try {
        buffer = await downloadBuffer(direct, request.abortSignal, 120_000, 1, cfg.retryBaseMs);
      } catch (error) {
        // If unsigned URL fails with auth error, fall back to authenticated endpoint
        if (error instanceof VideoProviderError && (error.status === 401 || error.status === 403)) {
          logger.warn("[VideoGen] OpenRouter unsigned URL failed with auth error, falling back to authenticated endpoint", "video", { jobId: final.id, errorStatus: error.status });
        } else {
          throw error;
        }
      }
    }
    // Fallback: authenticated content endpoint (GET /api/v1/videos/:id/content).
    if (!buffer) {
      const contentUrl = `${resolvePollingUrl(final.polling_url)}/content?index=0`;
      const res = await fetchWithRetry(contentUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: request.abortSignal,
        timeoutMs: 120_000,
        maxRetries: 1,
        retryBaseMs: cfg.retryBaseMs,
      });
      if (!res.ok) throw new VideoProviderError("generation_failed", `OpenRouter video content download failed (${res.status})`, { status: res.status });
      buffer = Buffer.from(await res.arrayBuffer());
    }
    if (buffer.length === 0) throw new VideoProviderError("generation_failed", "OpenRouter video download returned empty bytes");

    recordVideoMetric("openrouter", Date.now() - started, true, cost);
    logger.info("[VideoGen] OpenRouter video completed", "video", { jobId: final.id, cost, sizeBytes: buffer.length });
    return { videoBuffer: buffer, durationSeconds: duration, mimeType: "video/mp4", filename: `video-${final.id}.mp4`, cost };
  } catch (error) {
    if (error instanceof VideoProviderError) {
      if (error.code !== "budget_exceeded") recordVideoMetric("openrouter", Date.now() - started, false, undefined, error.code);
      throw error;
    }
    if ((error as Error)?.name === "AbortError" || request.abortSignal?.aborted) {
      const err = new VideoProviderError("aborted", "video generation aborted");
      recordVideoMetric("openrouter", Date.now() - started, false, undefined, err.code);
      throw err;
    }
    const err = new VideoProviderError("generation_failed", error instanceof Error ? error.message : String(error));
    recordVideoMetric("openrouter", Date.now() - started, false, undefined, err.code);
    throw err;
  }
}

// ── fal (subscribe handles queue polling; wrap with timeout) ─────────────────

async function generateFalVideo(request: ProviderVideoRequest): Promise<ProviderVideoResponse> {
  const started = Date.now();
  const cfg = getVideoConfig();
  const { model } = getAiConfiguration().video;
  const durationSec = snapDurationForProvider(request.duration ?? cfg.durationSeconds, "fal");
  const resolution = request.resolution ?? cfg.resolution;
  const aspectRatio = normalizeAspectRatio(request.aspectRatio ?? cfg.aspectRatio, "16:9");

  const estimatedCost = estimateVideoCost("fal", durationSec, resolution);
  if (!checkDailyBudget(estimatedCost)) {
    const err = new VideoProviderError("budget_exceeded", `Daily video budget exceeded. Estimated cost: $${estimatedCost.toFixed(2)}`);
    recordVideoMetric("fal", Date.now() - started, false, undefined, err.code);
    throw err;
  }

  const falKey = requireEnvironmentVariable("FAL_KEY");
  fal.config({ credentials: falKey });

  const input: Record<string, unknown> = {
    prompt: request.text,
    aspect_ratio: aspectRatio,
    duration: snapFalDurationString(durationSec),
    resolution: resolution === "1080p" || resolution === "4k" ? resolution : "720p",
    generate_audio: request.generateAudio ?? cfg.generateAudio,
  };
  if (request.referenceImages?.length) {
    // Text-to-video endpoint also accepts an image reference; data URLs avoid a
    // separate storage-upload round trip for small frames.
    input.image_url = openRouterReferenceDataUrl(request.referenceImages[0]!, request.referenceMimeTypes?.[0]);
  }

  try {
    const { signal, cancel } = combineSignals(request.abortSignal, cfg.timeoutMs);
    let result: { video?: { url?: string }; data?: { video?: { url?: string } } };
    try {
      result = (await fal.subscribe(model, { input, logs: false })) as typeof result;
    } finally {
      cancel();
    }
    void signal;
    const url = result?.video?.url ?? result?.data?.video?.url;
    if (!url) throw new VideoProviderError("generation_failed", "Fal.ai video generation did not return a video");
    const buffer = await downloadBuffer(url, request.abortSignal, 120_000, 1, cfg.retryBaseMs);
    if (buffer.length === 0) throw new VideoProviderError("generation_failed", "Fal.ai video download returned empty bytes");

    recordVideoMetric("fal", Date.now() - started, true, estimatedCost);
    logger.info("[VideoGen] fal video completed", "video", { model, cost: estimatedCost, sizeBytes: buffer.length });
    return {
      videoBuffer: buffer,
      durationSeconds: durationSec,
      mimeType: "video/mp4",
      filename: `video-${model.replace(/\//g, "-")}-${Date.now()}.mp4`,
      cost: estimatedCost,
    };
  } catch (error) {
    if (error instanceof VideoProviderError) {
      if (error.code !== "budget_exceeded") recordVideoMetric("fal", Date.now() - started, false, undefined, error.code);
      throw error;
    }
    const msg = error instanceof Error ? error.message : String(error);
    if (/\b402\b/.test(msg) || /payment required|quota|insufficient.*credit/i.test(msg)) {
      const err = new VideoProviderError("quota_exceeded", "Fal.ai quota exceeded or payment required. Check your Fal.ai account balance.");
      recordVideoMetric("fal", Date.now() - started, false, undefined, err.code);
      throw err;
    }
    if (/\b429\b/.test(msg) || /rate limit/i.test(msg)) {
      const err = new VideoProviderError("rate_limited", `Fal.ai rate limited: ${msg.slice(0, 200)}`, { retryable: true });
      recordVideoMetric("fal", Date.now() - started, false, undefined, err.code);
      throw err;
    }
    if (request.abortSignal?.aborted) {
      const err = new VideoProviderError("aborted", "video generation aborted");
      recordVideoMetric("fal", Date.now() - started, false, undefined, err.code);
      throw err;
    }
    const err = new VideoProviderError("generation_failed", msg.slice(0, 300));
    recordVideoMetric("fal", Date.now() - started, false, undefined, err.code);
    throw err;
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
      throw new VideoProviderError("invalid_request", `Video generation not yet supported by ${provider} provider. Use openrouter or fal for video generation.`);
    default:
      throw new VideoProviderError("invalid_request", `Unknown video provider: ${provider}`);
  }
}

/**
 * Get current cost control state for monitoring
 */
export function getVideoCostControlState(): VideoCostControlState {
  resetDailyCostIfNeeded();
  const dailyBudgetUsd = getVideoConfig().dailyBudgetUsd;
  return {
    dailyBudgetUsd,
    spentTodayUsd: costControlState.spentTodayUsd,
    remainingBudgetUsd: dailyBudgetUsd !== undefined
      ? Math.max(0, dailyBudgetUsd - costControlState.spentTodayUsd)
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

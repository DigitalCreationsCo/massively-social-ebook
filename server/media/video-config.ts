/**
 * Centralized video generation settings.
 *
 * Single source of truth for every configurable video knob so provider code
 * (OpenRouter / fal), the video service, and broadcast callers cannot drift.
 * Every value reads from the environment with a sane default; nothing here
 * performs I/O so it is cheap to call per request (env may change in tests).
 */

export type VideoAspectRatio = "16:9" | "9:16" | "1:1";
export type VideoResolution = "720p" | "1080p" | "4k";
export type VideoProviderName = "openrouter" | "fal";

export interface VideoCostTable {
  openrouter: Record<string, number>;
  fal: Record<string, number>;
}

export interface VideoConfig {
  provider: VideoProviderName;
  model: string;
  /** Seconds requested from the provider (snapped per provider at call time). */
  durationSeconds: number;
  resolution: VideoResolution;
  aspectRatio: VideoAspectRatio;
  generateAudio: boolean;
  /** Overall wall-clock budget for one generation (submit + poll + download). */
  timeoutMs: number;
  /** Delay between OpenRouter status polls. */
  pollIntervalMs: number;
  /** Max time spent polling an async job before giving up. */
  pollTimeoutMs: number;
  /** Retries for transient HTTP failures (429 / 5xx / network). */
  maxRetries: number;
  retryBaseMs: number;
  /** Quality gates. */
  maxBytes: number;
  minBytes: number;
  dailyBudgetUsd?: number;
  saveSessionVideos: boolean;
  saveAmbientVideos: boolean;
  cdnBaseUrl?: string;
  costPerSec: VideoCostTable;
}

const DEFAULT_MODELS: Record<VideoProviderName, string> = {
  openrouter: "google/veo-3.1",
  fal: "fal-ai/veo3.1",
};

function num(env: string | undefined, fallback: number): number {
  if (env === undefined || env.trim() === "") return fallback;
  const v = Number(env);
  return Number.isFinite(v) ? v : fallback;
}

function bool(env: string | undefined, fallback: boolean): boolean {
  if (env === undefined || env.trim() === "") return fallback;
  return env.trim().toLowerCase() === "true";
}

function optionalNum(env: string | undefined): number | undefined {
  if (env === undefined || env.trim() === "") return undefined;
  const v = Number(env);
  return Number.isFinite(v) ? v : undefined;
}

export function getVideoConfig(): VideoConfig {
  const providerRaw = (process.env.AI_VIDEO_PROVIDER ?? "openrouter").trim().toLowerCase();
  const provider: VideoProviderName = providerRaw === "fal" ? "fal" : "openrouter";
  const model =
    process.env.AI_VIDEO_MODEL?.trim() || DEFAULT_MODELS[provider];

  const aspectRaw = (process.env.VIDEO_ASPECT_RATIO ?? "16:9").trim();
  const aspectRatio: VideoAspectRatio =
    aspectRaw === "9:16" || aspectRaw === "1:1" ? aspectRaw : "16:9";

  const resolutionRaw = (process.env.VIDEO_RESOLUTION ?? "720p").trim();
  const resolution: VideoResolution =
    resolutionRaw === "1080p" || resolutionRaw === "4k" ? resolutionRaw : "720p";

  return {
    provider,
    model,
    durationSeconds: Math.max(1, Math.min(30, Math.round(num(process.env.VIDEO_DURATION_SECONDS, 8)))),
    resolution,
    aspectRatio,
    generateAudio: bool(process.env.VIDEO_GENERATE_AUDIO, true),
    timeoutMs: num(process.env.VIDEO_GEN_TIMEOUT_MS, 180_000),
    pollIntervalMs: num(process.env.VIDEO_POLL_INTERVAL_MS, 10_000),
    pollTimeoutMs: num(process.env.VIDEO_POLL_TIMEOUT_MS, 300_000),
    maxRetries: Math.max(0, Math.min(5, Math.round(num(process.env.VIDEO_GEN_MAX_RETRIES, 2)))),
    retryBaseMs: num(process.env.VIDEO_GEN_RETRY_BASE_MS, 1_000),
    maxBytes: num(process.env.VIDEO_MAX_BYTES, 100_000_000),
    minBytes: num(process.env.VIDEO_MIN_BYTES, 1_024),
    dailyBudgetUsd: optionalNum(process.env.VIDEO_DAILY_BUDGET_USD) ?? 10,
    saveSessionVideos: process.env.VIDEO_SAVE_SESSION !== "false",
    saveAmbientVideos: (process.env.VIDEO_SAVE_AMBIENT ?? "false").trim().toLowerCase() === "true",
    cdnBaseUrl: process.env.VIDEO_CDN_BASE_URL?.trim()?.replace(/\/+$/, "") || undefined,
    costPerSec: {
      openrouter: {
        "720p": num(process.env.VIDEO_COST_OPENROUTER_720P, 0.5),
        "1080p": num(process.env.VIDEO_COST_OPENROUTER_1080P, 0.75),
        "4k": num(process.env.VIDEO_COST_OPENROUTER_4K, 1.0),
      },
      fal: {
        "720p": num(process.env.VIDEO_COST_FAL_720P, 0.03),
        "1080p": num(process.env.VIDEO_COST_FAL_1080P, 0.05),
        "4k": num(process.env.VIDEO_COST_FAL_4K, 0.08),
      },
    },
  };
}

/**
 * Veo 3.1 (both providers) only supports 16:9 and 9:16. Map 1:1 to 16:9
 * (least surprising for landscape broadcast) instead of sending a value the
 * provider rejects with a 400.
 */
export function normalizeAspectRatio(
  aspect: VideoAspectRatio | string | undefined,
  fallback: VideoAspectRatio = "16:9",
): "16:9" | "9:16" {
  if (aspect === "9:16") return "9:16";
  if (aspect === "16:9") return "16:9";
  return fallback === "9:16" ? "9:16" : "16:9";
}

/** fal durations are an enum ("4s" | "6s" | "8s"); snap to the nearest. */
export function snapFalDurationString(seconds: number): "4s" | "6s" | "8s" {
  if (seconds <= 5) return "4s";
  if (seconds <= 7) return "6s";
  return "8s";
}

/** Numeric snap matching snapFalDurationString (4 / 6 / 8). */
export function snapDurationForProvider(seconds: number, provider: VideoProviderName): number {
  if (provider === "fal") {
    const s = snapFalDurationString(seconds);
    return s === "4s" ? 4 : s === "6s" ? 6 : 8;
  }
  return Math.max(1, Math.min(8, Math.round(seconds)));
}

export function estimateVideoCost(
  provider: VideoProviderName,
  durationSeconds: number,
  resolution: string,
  table?: VideoCostTable,
): number {
  const t = table ?? getVideoConfig().costPerSec;
  const perSec = t[provider]?.[resolution] ?? t[provider]?.["720p"] ?? 0.5;
  return durationSeconds * perSec;
}

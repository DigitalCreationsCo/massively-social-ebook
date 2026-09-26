import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getVideoConfig,
  normalizeAspectRatio,
  snapDurationForProvider,
  snapFalDurationString,
  estimateVideoCost,
} from "./video-config";

describe("video-config", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("should default to openrouter/veo-3.1 with streaming-friendly settings", () => {
    const cfg = getVideoConfig();
    expect(cfg.provider).toBe("openrouter");
    expect(cfg.model).toBe("google/veo-3.1");
    expect(cfg.durationSeconds).toBe(8);
    expect(cfg.resolution).toBe("720p");
    expect(cfg.aspectRatio).toBe("16:9");
    expect(cfg.generateAudio).toBe(true);
    expect(cfg.timeoutMs).toBe(180_000);
  });

  it("should honor env overrides", () => {
    vi.stubEnv("AI_VIDEO_PROVIDER", "fal");
    vi.stubEnv("VIDEO_DURATION_SECONDS", "6");
    vi.stubEnv("VIDEO_RESOLUTION", "1080p");
    vi.stubEnv("VIDEO_ASPECT_RATIO", "9:16");
    const cfg = getVideoConfig();
    expect(cfg.provider).toBe("fal");
    expect(cfg.model).toBe("fal-ai/veo3.1");
    expect(cfg.durationSeconds).toBe(6);
    expect(cfg.resolution).toBe("1080p");
    expect(cfg.aspectRatio).toBe("9:16");
  });

  it("should map 1:1 to 16:9 since Veo only supports 16:9/9:16", () => {
    expect(normalizeAspectRatio("1:1")).toBe("16:9");
    expect(normalizeAspectRatio("9:16")).toBe("9:16");
    expect(normalizeAspectRatio("16:9")).toBe("16:9");
    expect(normalizeAspectRatio(undefined)).toBe("16:9");
  });

  it("should snap fal durations to the 4s/6s/8s enum", () => {
    expect(snapFalDurationString(4)).toBe("4s");
    expect(snapFalDurationString(5)).toBe("4s");
    expect(snapFalDurationString(6)).toBe("6s");
    expect(snapFalDurationString(8)).toBe("8s");
    expect(snapDurationForProvider(5, "fal")).toBe(4);
    expect(snapDurationForProvider(5, "openrouter")).toBe(5);
  });

  it("should estimate cost from configurable per-second rates", () => {
    expect(estimateVideoCost("openrouter", 8, "720p")).toBeCloseTo(4.0);
    vi.stubEnv("VIDEO_COST_OPENROUTER_720P", "0.25");
    expect(estimateVideoCost("openrouter", 8, "720p")).toBeCloseTo(2.0);
  });
});

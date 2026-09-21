import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";

vi.mock("../blocks/ai-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../blocks/ai-provider")>();
  return { ...actual, generateProviderVideo: vi.fn() };
});

import { generateProviderVideo } from "../blocks/ai-provider";
import {
  generateMockVideo,
  generateMockVideoAsset,
  generateVideo,
  generateVideoAsset,
  type VideoSourceConfig,
  videoToUploadAsset,
  validateVideoBuffer,
  validateVideoQuality,
  applyCdnBaseUrl,
  optimizeVideoForStreaming,
  archiveVideo,
  downloadArchiveVideo,
  type VideoBuffer
} from "./video-service";

const mockGenerateProviderVideo = vi.mocked(generateProviderVideo);

/** Realistic minimal MP4: ftyp signature + padding past the min-bytes gate. */
function validMp4Bytes(size = 2048): Buffer {
  const header = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]);
  return Buffer.concat([header, Buffer.alloc(Math.max(0, size - header.length))]);
}

function mockUrlFetch(buffer: Buffer, mime = "video/mp4") {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: vi.fn().mockReturnValue(mime) },
    arrayBuffer: vi.fn().mockResolvedValue(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
  } as any);
}

describe("video-service", () => {
  beforeEach(() => {
    vi.stubEnv("VIDEO_MIN_BYTES", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    mockGenerateProviderVideo.mockReset();
  });

  describe("generateMockVideo", () => {
    it("should generate mock video from URL", async () => {
      const config: VideoSourceConfig = {
        type: "url",
        source: "https://test.spotme.com/sample.mp4",
        mimeType: "video/mp4"
      };

      mockUrlFetch(validMp4Bytes());

      const result = await generateMockVideo(config);

      expect(result).toBeDefined();
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.mimeType).toBe("video/mp4");
      expect(result.extension).toBe("mp4");
      expect(result.filename).toMatch(/^video-.*\.mp4$/);
      expect(result.durationSeconds).toBeGreaterThan(0);
    });

    it("should generate mock video from static file", async () => {
      const testDir = "/tmp/video-test";
      const testFile = `${testDir}/test-video.mp4`;

      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(testFile, validMp4Bytes());

      const config: VideoSourceConfig = {
        type: "static",
        source: testFile,
        mimeType: "video/mp4"
      };

      const result = await generateMockVideo(config);

      expect(result).toBeDefined();
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.mimeType).toBe("video/mp4");
      expect(result.extension).toBe("mp4");

      await fs.rm(testDir, { recursive: true, force: true });
    });

    it("should respect abort signal", async () => {
      const config: VideoSourceConfig = {
        type: "url",
        source: "https://test.spotme.com/sample.mp4"
      };

      const controller = new AbortController();
      controller.abort();

      await expect(
        generateMockVideo(config, { signal: controller.signal })
      ).rejects.toThrow();
    });

    it("should handle URL fetch failures", async () => {
      const config: VideoSourceConfig = {
        type: "url",
        source: "https://invalid-url.com/video.mp4"
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404
      } as any);

      await expect(generateMockVideo(config)).rejects.toThrow("Failed to fetch video from URL");
    });

    it("should handle static file read failures", async () => {
      const config: VideoSourceConfig = {
        type: "static",
        source: "/nonexistent/file.mp4"
      };

      await expect(generateMockVideo(config)).rejects.toThrow("Failed to read static video file");
    });

    it("should use custom target duration", async () => {
      const config: VideoSourceConfig = {
        type: "url",
        source: "https://test.spotme.com/sample.mp4"
      };

      mockUrlFetch(validMp4Bytes());

      const result = await generateMockVideo(config, { targetDurationSeconds: 30 });

      expect(result.durationSeconds).toBe(30);
    });
  });

  describe("mock asset archival gating", () => {
    const config: VideoSourceConfig = {
      type: "url",
      source: "https://test.spotme.com/sample.mp4"
    };

    it("builds a mock asset without archiving", async () => {
      mockUrlFetch(validMp4Bytes());

      vi.stubEnv("VIDEO_SAVE_SESSION", "true");
      const result = await generateMockVideoAsset(config, "test-channel", "session");

      expect(result).toBeDefined();
      expect(result.video).toBeDefined();
      expect(result.video.buffer).toBeInstanceOf(Buffer);
    });

    it("skips archival for ambient mode when disabled", async () => {
      mockUrlFetch(validMp4Bytes());

      vi.stubEnv("VIDEO_SAVE_AMBIENT", "false");
      const result = await generateMockVideoAsset(config, "test-channel", "ambient");

      expect(result).toBeDefined();
      expect(result.video).toBeDefined();
      expect(result.archiveUrl).toBeUndefined(); // Should not save ambient videos
    });

    it("skips archival for session mode when disabled", async () => {
      mockUrlFetch(validMp4Bytes());

      vi.stubEnv("VIDEO_SAVE_SESSION", "false");
      const result = await generateMockVideoAsset(config, "test-channel", "session");

      expect(result).toBeDefined();
      expect(result.video).toBeDefined();
      expect(result.archiveUrl).toBeUndefined(); // Should not save when disabled
    });
  });

  describe("generateVideo (production)", () => {
    beforeEach(() => {
      vi.stubEnv("AI_VIDEO_PROVIDER", "openrouter");
      vi.stubEnv("AI_VIDEO_MODEL", "google/veo-3.1");
      vi.stubEnv("OPENROUTER_API_KEY", "test-key");
      vi.stubEnv("VIDEO_DAILY_BUDGET_USD", "10");
    });

    it("should integrate with production video provider", async () => {
      mockGenerateProviderVideo.mockResolvedValue({
        videoBuffer: validMp4Bytes(),
        durationSeconds: 8,
        mimeType: "video/mp4",
        filename: "video-test.mp4",
        cost: 2.5,
      });

      const result = await generateVideo("test description");

      expect(result).toBeDefined();
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.durationSeconds).toBe(8);
      expect(result.mimeType).toBe("video/mp4");
      expect(result.filename).toBe("video-test.mp4");
    });

    it("should reject provider bytes that fail quality checks", async () => {
      mockGenerateProviderVideo.mockResolvedValue({
        videoBuffer: Buffer.from("fake video data"),
        durationSeconds: 8,
        mimeType: "video/mp4",
        filename: "video-test.mp4",
        cost: 2.5,
      });

      await expect(generateVideo("test description")).rejects.toThrow("quality checks");
    });

    it("should handle provider errors gracefully", async () => {
      mockGenerateProviderVideo.mockRejectedValue(
        new Error("Provider quota exceeded")
      );

      await expect(generateVideo("test description")).rejects.toThrow("quota exceeded");
    });

    it("should handle budget exceeded errors specifically", async () => {
      const { VideoProviderError } = await import("../blocks/ai-provider");
      mockGenerateProviderVideo.mockRejectedValue(
        new VideoProviderError("budget_exceeded", "Daily video budget exceeded. Estimated cost: $15.00")
      );

      await expect(generateVideo("test description")).rejects.toThrow("Daily video budget limit reached");
    });

    it("should surface rate-limit errors with a retryable message", async () => {
      const { VideoProviderError } = await import("../blocks/ai-provider");
      mockGenerateProviderVideo.mockRejectedValue(
        new VideoProviderError("rate_limited", "rate limited", { status: 429, retryable: true })
      );

      await expect(generateVideo("test description")).rejects.toThrow("rate limit");
    });
  });

  describe("generateVideoAsset (production)", () => {
    beforeEach(() => {
      vi.stubEnv("AI_VIDEO_PROVIDER", "openrouter");
      vi.stubEnv("AI_VIDEO_MODEL", "google/veo-3.1");
      vi.stubEnv("OPENROUTER_API_KEY", "test-key");
      vi.stubEnv("VIDEO_DAILY_BUDGET_USD", "10");
      vi.stubEnv("VIDEO_SAVE_SESSION", "true");
      vi.stubEnv("PUBLIC_BASE_URL", "http://localhost:3000");
      // Force the local archival path: a bucket in the ambient env would
      // route to GCS (or a dead emulator) instead.
      vi.stubEnv("GOOGLE_CLOUD_BUCKET", "");
    });

    it("should generate video asset with archival for session mode", async () => {
      mockGenerateProviderVideo.mockResolvedValue({
        videoBuffer: validMp4Bytes(),
        durationSeconds: 8,
        mimeType: "video/mp4",
        filename: "video-test.mp4",
        cost: 2.5,
      });

      const result = await generateVideoAsset("test description", "test-channel", "session");

      expect(result).toBeDefined();
      expect(result.video).toBeDefined();
      expect(result.archiveUrl).toBeDefined(); // Should save session videos
      await fs.rm("server/public/video/video-test.mp4", { force: true });
    });

    it("should skip archival for ambient mode when configured", async () => {
      vi.stubEnv("VIDEO_SAVE_AMBIENT", "false");
      mockGenerateProviderVideo.mockResolvedValue({
        videoBuffer: validMp4Bytes(),
        durationSeconds: 8,
        mimeType: "video/mp4",
        filename: "video-test.mp4",
        cost: 2.5,
      });

      const result = await generateVideoAsset("test description", "test-channel", "ambient");

      expect(result).toBeDefined();
      expect(result.video).toBeDefined();
      expect(result.archiveUrl).toBeUndefined(); // Should not save ambient videos
    });
  });

  describe("videoToUploadAsset", () => {
    it("should convert video buffer to upload asset", async () => {
      const videoBuffer: VideoBuffer = {
        buffer: validMp4Bytes(),
        durationSeconds: 10,
        extension: "mp4",
        mimeType: "video/mp4",
        filename: "test-video.mp4"
      };

      const asset = await videoToUploadAsset(videoBuffer);

      expect(asset).toBeDefined();
      expect(asset.data).toBeInstanceOf(Blob);
      expect(asset.filename).toBe("test-video.mp4");
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should reject empty video buffer", async () => {
      const videoBuffer: VideoBuffer = {
        buffer: Buffer.alloc(0),
        durationSeconds: 10,
        extension: "mp4",
        mimeType: "video/mp4",
        filename: "empty-video.mp4"
      };

      await expect(videoToUploadAsset(videoBuffer)).rejects.toThrow();
    });

    it("should reject bytes that fail quality checks", async () => {
      const videoBuffer: VideoBuffer = {
        buffer: Buffer.from("not a video at all, just text bytes...."),
        durationSeconds: 10,
        extension: "mp4",
        mimeType: "video/mp4",
        filename: "bad-video.mp4"
      };

      await expect(videoToUploadAsset(videoBuffer)).rejects.toThrow("quality checks");
    });
  });

  describe("validateVideoBuffer", () => {
    it("should validate MP4 buffer signature", () => {
      const validMp4 = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]);
      expect(validateVideoBuffer(validMp4, "video/mp4")).toBe(true);
    });

    it("should validate WebM buffer signature", () => {
      const validWebM = Buffer.from([0x1A, 0x45, 0xDF, 0xA3]);
      expect(validateVideoBuffer(validWebM, "video/webm")).toBe(true);
    });

    it("should reject invalid MP4 buffer", () => {
      const invalidMp4 = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]);
      expect(validateVideoBuffer(invalidMp4, "video/mp4")).toBe(false);
    });

    it("should reject buffers that are too small", () => {
      const tinyBuffer = Buffer.from([0x00, 0x00]);
      expect(validateVideoBuffer(tinyBuffer, "video/mp4")).toBe(false);
    });

    it("should accept unknown MIME types", () => {
      const buffer = Buffer.from([0x00, 0x00, 0x00, 0x20]);
      expect(validateVideoBuffer(buffer, "video/unknown")).toBe(true);
    });
  });

  describe("validateVideoQuality", () => {
    it("should pass a well-formed video", () => {
      expect(validateVideoQuality(validMp4Bytes(), "video/mp4", 8).ok).toBe(true);
    });

    it("should flag signature mismatches", () => {
      const report = validateVideoQuality(Buffer.alloc(2048, 0xff), "video/mp4", 8);
      expect(report.ok).toBe(false);
      expect(report.issues.join(" ")).toMatch(/signature/);
    });

    it("should flag unsupported mime types and bad durations", () => {
      expect(validateVideoQuality(validMp4Bytes(), "video/avi", 8).ok).toBe(false);
      expect(validateVideoQuality(validMp4Bytes(), "video/mp4", 0).ok).toBe(false);
    });
  });

  describe("applyCdnBaseUrl", () => {
    it("should pass through when no CDN is configured", () => {
      expect(applyCdnBaseUrl("https://storage.googleapis.com/b/v.mp4"))
        .toBe("https://storage.googleapis.com/b/v.mp4");
    });

    it("should rewrite onto the CDN base when configured", () => {
      vi.stubEnv("VIDEO_CDN_BASE_URL", "https://cdn.example.com");
      expect(applyCdnBaseUrl("https://storage.googleapis.com/b/v.mp4"))
        .toBe("https://cdn.example.com/b/v.mp4");
    });
  });

  describe("optimizeVideoForStreaming", () => {
    it("should pass through streamable mp4", () => {
      const video: VideoBuffer = {
        buffer: validMp4Bytes(),
        durationSeconds: 8,
        extension: "mp4",
        mimeType: "video/mp4",
        filename: "v.mp4",
      };
      expect(optimizeVideoForStreaming(video)).toBe(video);
    });
  });

  describe("archiveVideo", () => {
    it.skip("should archive video to GCS when configured", async () => {
      // Skip this test in CI environments without GCS credentials
      const videoBuffer: VideoBuffer = {
        buffer: validMp4Bytes(),
        durationSeconds: 10,
        extension: "mp4",
        mimeType: "video/mp4",
        filename: "test-video.mp4"
      };

      process.env.GOOGLE_CLOUD_BUCKET = "test-bucket";
      process.env.GOOGLE_CLOUD_PROJECT = "test-project";

      const result = await archiveVideo(videoBuffer, "test-channel", "ambient");

      expect(result).toMatch(/^https:\/\/storage\.googleapis\.com/);

      delete process.env.GOOGLE_CLOUD_BUCKET;
      delete process.env.GOOGLE_CLOUD_PROJECT;
    });

    it("should archive video to local storage when GCS not configured", async () => {
      const videoBuffer: VideoBuffer = {
        buffer: validMp4Bytes(),
        durationSeconds: 10,
        extension: "mp4",
        mimeType: "video/mp4",
        filename: "test-video-local.mp4"
      };

      delete process.env.GOOGLE_CLOUD_BUCKET;
      process.env.PUBLIC_BASE_URL = "http://localhost:3000";
      vi.stubEnv("VIDEO_SAVE_SESSION", "true");

      const result = await archiveVideo(videoBuffer, "test-channel", "session");

      expect(result).toMatch(/^http:\/\/localhost:3000\/video\//);

      await fs.rm("server/public/video/test-video-local.mp4", { force: true });
      delete process.env.PUBLIC_BASE_URL;
    });

    it("should throw error when neither GCS nor PUBLIC_BASE_URL configured", async () => {
      const videoBuffer: VideoBuffer = {
        buffer: validMp4Bytes(),
        durationSeconds: 10,
        extension: "mp4",
        mimeType: "video/mp4",
        filename: "test-video.mp4"
      };

      delete process.env.GOOGLE_CLOUD_BUCKET;
      delete process.env.PUBLIC_BASE_URL;
      vi.stubEnv("VIDEO_SAVE_SESSION", "true");

      await expect(
        archiveVideo(videoBuffer, "test-channel", "session")
      ).rejects.toThrow("PUBLIC_BASE_URL is required");
    });
  });

  describe("downloadArchiveVideo", () => {
    it("should return null when GCS not configured", async () => {
      delete process.env.GOOGLE_CLOUD_BUCKET;

      const result = await downloadArchiveVideo("https://storage.googleapis.com/bucket/video.mp4");
      expect(result).toBeNull();
    });

    it.skip("should return null for foreign URLs", async () => {
      // Skip this test in CI environments without GCS credentials
      process.env.GOOGLE_CLOUD_BUCKET = "my-bucket";

      const result = await downloadArchiveVideo("https://other-bucket.com/video.mp4");
      expect(result).toBeNull();

      delete process.env.GOOGLE_CLOUD_BUCKET;
    });
  });
});

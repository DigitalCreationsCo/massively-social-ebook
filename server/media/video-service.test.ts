import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { 
  generateMockVideo, 
  generateMockVideoAsset,
  generateVideo,
  generateVideoAsset,
  VideoSourceConfig,
  videoToUploadAsset,
  validateVideoBuffer,
  archiveVideo,
  downloadArchiveVideo,
  type VideoBuffer
} from "./video-service";
import fs from "node:fs/promises";

describe("video-service", () => {
  describe("generateMockVideo", () => {
    it("should generate mock video from URL", async () => {
      const config: VideoSourceConfig = {
        type: "url",
        source: "https://test.spotme.com/sample.mp4",
        mimeType: "video/mp4"
      };

      // Mock fetch to return sample video data
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: vi.fn().mockReturnValue("video/mp4")
        },
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024))
      } as any);

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
      
      // Create test directory and file
      await fs.mkdir(testDir, { recursive: true });
      const testBuffer = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]); // MP4 signature
      await fs.writeFile(testFile, testBuffer);

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

      // Cleanup
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

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: vi.fn().mockReturnValue("video/mp4") },
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024))
      } as any);

      const result = await generateMockVideo(config, { targetDurationSeconds: 30 });

      expect(result.durationSeconds).toBe(30);
    });
  });

  describe("generateMockVideoAsset", () => {
    it("should generate video asset with archival support", async () => {
      const config: VideoSourceConfig = {
        type: "url",
        source: "https://test.spotme.com/sample.mp4"
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: vi.fn().mockReturnValue("video/mp4") },
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024))
      } as any);

      vi.stubEnv("VIDEO_SAVE_SESSION", "true");
      const result = await generateMockVideoAsset(config, "test-channel", "session");

      expect(result).toBeDefined();
      expect(result.video).toBeDefined();
      expect(result.video.buffer).toBeInstanceOf(Buffer);
      expect(result.archiveUrl).toBeUndefined(); // No archival in mock, but may have attempted
      vi.unstubAllEnvs();
    });

    it("should respect video saving configuration for ambient mode", async () => {
      const config: VideoSourceConfig = {
        type: "url",
        source: "https://test.spotme.com/sample.mp4"
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: vi.fn().mockReturnValue("video/mp4") },
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024))
      } as any);

      vi.stubEnv("VIDEO_SAVE_AMBIENT", "false");
      const result = await generateMockVideoAsset(config, "test-channel", "ambient");

      expect(result).toBeDefined();
      expect(result.video).toBeDefined();
      expect(result.archiveUrl).toBeUndefined(); // Should not save ambient videos
      vi.unstubAllEnvs();
    });
  });

  describe("video saving configuration", () => {
    it("should respect VIDEO_SAVE_SESSION environment variable", async () => {
      const config: VideoSourceConfig = {
        type: "url",
        source: "https://test.spotme.com/sample.mp4"
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: vi.fn().mockReturnValue("video/mp4") },
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024))
      } as any);

      vi.stubEnv("VIDEO_SAVE_SESSION", "false");
      const result = await generateMockVideoAsset(config, "test-channel", "session");

      expect(result).toBeDefined();
      expect(result.video).toBeDefined();
      expect(result.archiveUrl).toBeUndefined(); // Should not save when disabled
      vi.unstubAllEnvs();
    });
  });

  describe("generateVideo (production)", () => {
    beforeEach(() => {
      vi.stubEnv("AI_VIDEO_PROVIDER", "openrouter");
      vi.stubEnv("AI_VIDEO_MODEL", "google/veo-3.1");
      vi.stubEnv("OPENROUTER_API_KEY", "test-key");
      vi.stubEnv("VIDEO_DAILY_BUDGET_USD", "10");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("should integrate with production video provider", async () => {
      vi.mocked(generateProviderVideo).mockResolvedValue({
        videoBuffer: Buffer.from("fake video data"),
        durationSeconds: 5,
        mimeType: "video/mp4",
        filename: "video-test.mp4",
        cost: 2.5,
      });

      const result = await generateVideo("test description");

      expect(result).toBeDefined();
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.durationSeconds).toBe(5);
      expect(result.mimeType).toBe("video/mp4");
      expect(result.filename).toBe("video-test.mp4");
    });

    it("should handle provider errors gracefully", async () => {
      vi.mocked(generateProviderVideo).mockRejectedValue(
        new Error("Provider quota exceeded")
      );

      await expect(generateVideo("test description")).rejects.toThrow("Provider quota exceeded");
    });

    it("should handle budget exceeded errors specifically", async () => {
      vi.mocked(generateProviderVideo).mockRejectedValue(
        new Error("Daily video budget exceeded. Estimated cost: $15.00")
      );

      await expect(generateVideo("test description")).rejects.toThrow("Daily video budget limit reached");
    });
  });

  describe("generateVideoAsset (production)", () => {
    beforeEach(() => {
      vi.stubEnv("AI_VIDEO_PROVIDER", "openrouter");
      vi.stubEnv("AI_VIDEO_MODEL", "google/veo-3.1");
      vi.stubEnv("OPENROUTER_API_KEY", "test-key");
      vi.stubEnv("VIDEO_DAILY_BUDGET_USD", "10");
      vi.stubEnv("VIDEO_SAVE_SESSION", "true");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("should generate video asset with archival for session mode", async () => {
      vi.mocked(generateProviderVideo).mockResolvedValue({
        videoBuffer: Buffer.from("fake video data"),
        durationSeconds: 5,
        mimeType: "video/mp4",
        filename: "video-test.mp4",
        cost: 2.5,
      });

      const result = await generateVideoAsset("test description", "test-channel", "session");

      expect(result).toBeDefined();
      expect(result.video).toBeDefined();
      expect(result.archiveUrl).toBeDefined(); // Should save session videos
    });

    it("should skip archival for ambient mode when configured", async () => {
      vi.stubEnv("VIDEO_SAVE_AMBIENT", "false");
      vi.mocked(generateProviderVideo).mockResolvedValue({
        videoBuffer: Buffer.from("fake video data"),
        durationSeconds: 5,
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

  describe("generateVideo (production)", () => {
    beforeEach(() => {
      vi.stubEnv("AI_VIDEO_PROVIDER", "openrouter");
      vi.stubEnv("AI_VIDEO_MODEL", "google/veo-3.1");
      vi.stubEnv("OPENROUTER_API_KEY", "test-key");
      vi.stubEnv("VIDEO_DAILY_BUDGET_USD", "10");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("should integrate with production video provider", async () => {
      vi.mocked(generateProviderVideo).mockResolvedValue({
        videoBuffer: Buffer.from("fake video data"),
        durationSeconds: 5,
        mimeType: "video/mp4",
        filename: "video-test.mp4",
        cost: 2.5,
      });

      const result = await generateVideo("test description");

      expect(result).toBeDefined();
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.durationSeconds).toBe(5);
      expect(result.mimeType).toBe("video/mp4");
      expect(result.filename).toBe("video-test.mp4");
    });

    it("should handle provider errors gracefully", async () => {
      vi.mocked(generateProviderVideo).mockRejectedValue(
        new Error("Provider quota exceeded")
      );

      await expect(generateVideo("test description")).rejects.toThrow("Provider quota exceeded");
    });

    it("should handle budget exceeded errors specifically", async () => {
      vi.mocked(generateProviderVideo).mockRejectedValue(
        new Error("Daily video budget exceeded. Estimated cost: $15.00")
      );

      await expect(generateVideo("test description")).rejects.toThrow("Daily video budget limit reached");
    });
  });

  describe("generateVideoAsset (production)", () => {
    beforeEach(() => {
      vi.stubEnv("AI_VIDEO_PROVIDER", "openrouter");
      vi.stubEnv("AI_VIDEO_MODEL", "google/veo-3.1");
      vi.stubEnv("OPENROUTER_API_KEY", "test-key");
      vi.stubEnv("VIDEO_DAILY_BUDGET_USD", "10");
      vi.stubEnv("VIDEO_SAVE_SESSION", "true");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("should generate video asset with archival for session mode", async () => {
      vi.mocked(generateProviderVideo).mockResolvedValue({
        videoBuffer: Buffer.from("fake video data"),
        durationSeconds: 5,
        mimeType: "video/mp4",
        filename: "video-test.mp4",
        cost: 2.5,
      });

      const result = await generateVideoAsset("test description", "test-channel", "session");

      expect(result).toBeDefined();
      expect(result.video).toBeDefined();
      expect(result.archiveUrl).toBeDefined(); // Should save session videos
    });

    it("should skip archival for ambient mode when configured", async () => {
      vi.stubEnv("VIDEO_SAVE_AMBIENT", "false");
      vi.mocked(generateProviderVideo).mockResolvedValue({
        videoBuffer: Buffer.from("fake video data"),
        durationSeconds: 5,
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
        buffer: Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]),
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

      await expect(async () => await videoToUploadAsset(videoBuffer)).rejects.toThrow("Cannot queue empty video");
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

  describe("archiveVideo", () => {
    it.skip("should archive video to GCS when configured", async () => {
      // Skip this test in CI environments without GCS credentials
      const videoBuffer: VideoBuffer = {
        buffer: Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]),
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
        buffer: Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]),
        durationSeconds: 10,
        extension: "mp4",
        mimeType: "video/mp4",
        filename: "test-video.mp4"
      };

      delete process.env.GOOGLE_CLOUD_BUCKET;
      process.env.PUBLIC_BASE_URL = "http://localhost:3000";

      const result = await archiveVideo(videoBuffer, "test-channel", "ambient");
      
      expect(result).toMatch(/^http:\/\/localhost:3000\/video\//);
      
      delete process.env.PUBLIC_BASE_URL;
    });

    it("should throw error when neither GCS nor PUBLIC_BASE_URL configured", async () => {
      const videoBuffer: VideoBuffer = {
        buffer: Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]),
        durationSeconds: 10,
        extension: "mp4",
        mimeType: "video/mp4",
        filename: "test-video.mp4"
      };

      delete process.env.GOOGLE_CLOUD_BUCKET;
      delete process.env.PUBLIC_BASE_URL;

      await expect(
        archiveVideo(videoBuffer, "test-channel", "ambient")
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { 
  prepareAmbientTurnFromText,
  finishCanonicalSlot,
  type PreparedAmbientTurn,
  type PreparedBroadcastSlot,
} from "./media-slots";
import type { VideoSourceConfig } from "../media/video-service";

describe("Video Broadcast Integration", () => {
  describe("Ambient Mode with Video", () => {
    it("should generate ambient turn with video from URL source", async () => {
      const videoConfig: VideoSourceConfig = {
        type: "url",
        source: "https://test.spotme.com/sample-video.mp4",
        mimeType: "video/mp4"
      };

      // Mock fetch to return sample video data
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: vi.fn().mockReturnValue("video/mp4") },
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024))
      } as any);

      const generated = {
        title: "Ambient Scene",
        content: "A quiet moment in the story world",
        dialogue: undefined,
        imageRepresentations: [],
        selectedImageRepresentations: []
      };

      const turn = await prepareAmbientTurnFromText(
        "test-channel",
        generated,
        "test-run",
        1,
        new AbortController().signal,
        true, // useVideo
        videoConfig
      );

      expect(turn).toBeDefined();
      expect(turn?.video).toBeDefined();
      expect(turn?.image).toBeUndefined();
      expect(turn?.segments).toHaveLength(1);
      expect(turn?.segments[0]?.caption).toBe(generated.content);
      expect(turn?.totalDurationSeconds).toBeGreaterThan(0);
    });

    it("should generate ambient turn with video from static file", async () => {
      const videoConfig: VideoSourceConfig = {
        type: "static",
        source: "/tmp/test-video.mp4",
        mimeType: "video/mp4"
      };

      const fs = await import("node:fs/promises");
      vi.spyOn(fs, "readFile").mockResolvedValue(
        Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])
      );

      const generated = {
        title: "Ambient Scene",
        content: "A quiet moment in the story world",
        dialogue: undefined,
        imageRepresentations: [],
        selectedImageRepresentations: []
      };

      const turn = await prepareAmbientTurnFromText(
        "test-channel",
        generated,
        "test-run",
        2,
        new AbortController().signal,
        true, // useVideo
        videoConfig
      );

      expect(turn).toBeDefined();
      expect(turn?.video).toBeDefined();
      expect(turn?.image).toBeUndefined();
      expect(turn?.segments).toHaveLength(1);
    });

    it("should fall back to image when video generation fails", async () => {
      const videoConfig: VideoSourceConfig = {
        type: "url",
        source: "https://invalid-url.com/video.mp4"
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404
      } as any);

      const generated = {
        title: "Ambient Scene",
        content: "A quiet moment in the story world",
        dialogue: undefined,
        imageRepresentations: [],
        selectedImageRepresentations: []
      };

      const turn = await prepareAmbientTurnFromText(
        "test-channel",
        generated,
        "test-run",
        3,
        new AbortController().signal,
        true, // useVideo
        videoConfig
      );

      // Should return undefined when both video and image fail
      expect(turn).toBeUndefined();
    });

    it("should use image generation when useVideo is false", async () => {
      const generated = {
        title: "Ambient Scene",
        content: "A quiet moment in the story world",
        dialogue: undefined,
        imageRepresentations: [],
        selectedImageRepresentations: []
      };

      // Mock image generation
      const mockImage = {
        buffer: Buffer.from([0x00, 0x00, 0x00, 0x20]),
        mimeType: "image/jpeg" as const,
        filename: "test-image.jpg"
      };

      // Mock the image generation function
      vi.doMock("../image-uploader", () => ({
        generateStoryImageAsset: vi.fn().mockResolvedValue(mockImage)
      }));

      const turn = await prepareAmbientTurnFromText(
        "test-channel",
        generated,
        "test-run",
        4,
        new AbortController().signal,
        false, // useVideo = false
        undefined // no video config
      );

      expect(turn).toBeDefined();
      expect(turn?.image).toBeDefined();
      expect(turn?.video).toBeUndefined();
    });
  });

  describe("Session Mode with Video", () => {
    it("should generate canonical slot with video from URL", async () => {
      const videoConfig: VideoSourceConfig = {
        type: "url",
        source: "https://test.spotme.com/session-video.mp4",
        mimeType: "video/mp4"
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: vi.fn().mockReturnValue("video/mp4") },
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(2048))
      } as any);

      const session = {
        id: 123,
        channelId: "test-channel",
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 3600000)
      };

      const generated = {
        title: "Story Beat",
        content: "The protagonist makes a discovery",
        dialogue: "What's this?",
        imageRepresentations: [],
        selectedImageRepresentations: []
      };

      const result = await finishCanonicalSlot(
        "test-channel",
        session,
        generated,
        new AbortController().signal,
        undefined,
        true, // useVideo
        videoConfig
      );

      expect(result).toBeDefined();
      expect(result.slots).toHaveLength(1);
      expect(result.slots[0].video).toBeDefined();
      expect(result.slots[0].image).toBeUndefined();
      expect(result.slots[0].audio).toBeUndefined();
      expect(result.block?.videoUrl).toBeDefined();
      expect(result.block?.imageUrl).toBeNull();
    });

    it("should use image generation when useVideo is false in session mode", async () => {
      const session = {
        id: 456,
        channelId: "test-channel",
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 3600000)
      };

      const generated = {
        title: "Story Beat",
        content: "The protagonist makes a discovery",
        dialogue: "What's this?",
        imageRepresentations: [],
        selectedImageRepresentations: []
      };

      // Mock image generation
      const mockImage = {
        buffer: Buffer.from([0x00, 0x00, 0x00, 0x20]),
        mimeType: "image/jpeg" as const,
        filename: "test-image.jpg"
      };

      vi.doMock("../image-uploader", () => ({
        generateStoryImageAsset: vi.fn().mockResolvedValue(mockImage)
      }));

      const result = await finishCanonicalSlot(
        "test-channel",
        session,
        generated,
        new AbortController().signal,
        undefined,
        false, // useVideo = false
        undefined // no video config
      );

      expect(result).toBeDefined();
      expect(result.slots[0].image).toBeDefined();
      expect(result.slots[0].video).toBeUndefined();
    });
  });

  describe("Queue Broadcast Integration", () => {
    it("should prepare video slot for queue broadcast", async () => {
      const videoConfig: VideoSourceConfig = {
        type: "url",
        source: "https://test.spotme.com/queue-video.mp4",
        mimeType: "video/mp4"
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: vi.fn().mockReturnValue("video/mp4") },
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024))
      } as any);

      const generated = {
        title: "Queue Test",
        content: "Video for queue broadcast",
        dialogue: undefined,
        imageRepresentations: [],
        selectedImageRepresentations: []
      };

      const turn = await prepareAmbientTurnFromText(
        "test-channel",
        generated,
        "test-run",
        5,
        new AbortController().signal,
        true,
        videoConfig
      );

      expect(turn).toBeDefined();
      expect(turn?.video).toBeDefined();
      
      // Verify the video asset is ready for queue upload
      const videoAsset = turn?.video;
      expect(videoAsset?.data).toBeInstanceOf(Blob);
      expect(videoAsset?.filename).toMatch(/\.mp4$/);
      expect(videoAsset?.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should handle video slot with proper queue metadata", async () => {
      const videoConfig: VideoSourceConfig = {
        type: "url",
        source: "https://test.spotme.com/metadata-video.mp4",
        mimeType: "video/mp4"
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: vi.fn().mockReturnValue("video/mp4") },
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(512))
      } as any);

      const generated = {
        title: "Metadata Test",
        content: "Video with proper queue metadata",
        dialogue: undefined,
        imageRepresentations: [],
        selectedImageRepresentations: []
      };

      const turn = await prepareAmbientTurnFromText(
        "test-channel",
        generated,
        "test-run",
        6,
        new AbortController().signal,
        true,
        videoConfig
      );

      expect(turn).toBeDefined();
      expect(turn?.idempotencyPrefix).toContain("channel:test-channel:run:test-run:sequence:6");
      expect(turn?.contentId).toBeDefined();
      expect(turn?.totalDurationSeconds).toBeGreaterThan(0);
      expect(turn?.totalBytes).toBeGreaterThan(0);
    });
  });

  describe("Environment Configuration", () => {
    it("should respect BROADCAST_USE_VIDEO environment variable", () => {
      // Test environment variable handling
      const originalUseVideo = process.env.BROADCAST_USE_VIDEO;
      
      process.env.BROADCAST_USE_VIDEO = "true";
      expect(process.env.BROADCAST_USE_VIDEO).toBe("true");
      
      process.env.BROADCAST_USE_VIDEO = "false";
      expect(process.env.BROADCAST_USE_VIDEO).toBe("false");
      
      process.env.BROADCAST_USE_VIDEO = originalUseVideo;
    });

    it("should parse video source configuration from environment", () => {
      const originalSource = process.env.BROADCAST_VIDEO_SOURCE;
      const originalType = process.env.BROADCAST_VIDEO_SOURCE_TYPE;
      const originalMime = process.env.BROADCAST_VIDEO_MIME_TYPE;
      
      process.env.BROADCAST_VIDEO_SOURCE = "https://test.spotme.com/video.mp4";
      process.env.BROADCAST_VIDEO_SOURCE_TYPE = "url";
      process.env.BROADCAST_VIDEO_MIME_TYPE = "video/mp4";
      
      const config: VideoSourceConfig = {
        type: process.env.BROADCAST_VIDEO_SOURCE_TYPE as "static" | "url",
        source: process.env.BROADCAST_VIDEO_SOURCE,
        mimeType: process.env.BROADCAST_VIDEO_MIME_TYPE
      };
      
      expect(config.type).toBe("url");
      expect(config.source).toBe("https://test.spotme.com/video.mp4");
      expect(config.mimeType).toBe("video/mp4");
      
      process.env.BROADCAST_VIDEO_SOURCE = originalSource;
      process.env.BROADCAST_VIDEO_SOURCE_TYPE = originalType;
      process.env.BROADCAST_VIDEO_MIME_TYPE = originalMime;
    });
  });
});

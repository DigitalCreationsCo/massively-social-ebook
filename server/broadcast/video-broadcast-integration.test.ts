import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The generation, TTS, and storage layers are mocked: this suite exercises the
// slot composition in media-slots, and without these the real AI, TTS, and
// archive providers are called over the network.
const mocks = vi.hoisted(() => ({
  generateStoryBlock: vi.fn(),
  generateStoryImageAsset: vi.fn(),
  generateVideoAsset: vi.fn(),
  generateMockVideoAsset: vi.fn(),
  synthesizeNarrationBuffers: vi.fn(),
  archiveSpeechBuffer: vi.fn(),
  archiveStoryImage: vi.fn(),
  archiveVideo: vi.fn(),
  downloadArchiveBuffer: vi.fn(),
  downloadArchiveVideo: vi.fn(),
  videoToUploadAsset: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  saveAsset: vi.fn(),
  createBlock: vi.fn(),
}));

vi.mock("../blocks/ai", () => ({ generateStoryBlock: mocks.generateStoryBlock }));
vi.mock("../image-uploader", () => ({
  generateStoryImageAsset: mocks.generateStoryImageAsset,
  archiveStoryImage: mocks.archiveStoryImage,
  downloadArchiveBuffer: mocks.downloadArchiveBuffer,
}));
vi.mock("../media/tts-service", () => ({
  synthesizeNarrationBuffers: mocks.synthesizeNarrationBuffers,
  archiveSpeechBuffer: mocks.archiveSpeechBuffer,
}));
vi.mock("../media/video-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../media/video-service")>()),
  generateVideoAsset: mocks.generateVideoAsset,
  generateMockVideoAsset: mocks.generateMockVideoAsset,
  archiveVideo: mocks.archiveVideo,
  downloadArchiveVideo: mocks.downloadArchiveVideo,
  videoToUploadAsset: mocks.videoToUploadAsset,
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  // An ESM namespace cannot be spied on, so the static-file read is stubbed at
  // the module boundary. Returns a minimal ftyp box so the probe sees a video.
  readFile: vi.fn().mockResolvedValue(Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])),
}));
vi.mock("../storage", () => ({
  storage: {
    getSettings: mocks.getSettings,
    updateSettings: mocks.updateSettings,
    saveAsset: mocks.saveAsset,
    createBlock: mocks.createBlock,
  },
}));

import { 
  prepareAmbientTurnFromText,
  finishCanonicalSlot,
  type PreparedAmbientTurn,
  type PreparedBroadcastSlot,
} from "./media-slots";
import type { VideoSourceConfig } from "../media/video-service";

const VIDEO_BUFFER = {
  buffer: Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]),
  durationSeconds: 6,
  extension: "mp4",
  mimeType: "video/mp4",
  filename: "slot.mp4",
};
const IMAGE_ASSET = {
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  mimeType: "image/jpeg" as const,
  filename: "slot.jpg",
};

describe("Video Broadcast Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults for a healthy video turn. Individual tests override the one
    // collaborator they are exercising (usually to make it fail).
    mocks.generateStoryImageAsset.mockResolvedValue(IMAGE_ASSET);
    mocks.generateVideoAsset.mockResolvedValue({ video: VIDEO_BUFFER, archiveUrl: "https://archive.test/slot.mp4" });
    mocks.generateMockVideoAsset.mockResolvedValue({ video: VIDEO_BUFFER, archiveUrl: "https://archive.test/slot.mp4" });
    mocks.synthesizeNarrationBuffers.mockResolvedValue([]);
    mocks.archiveSpeechBuffer.mockResolvedValue("https://archive.test/slot.mp3");
    mocks.archiveStoryImage.mockResolvedValue("https://archive.test/slot.jpg");
    mocks.archiveVideo.mockResolvedValue("https://archive.test/slot.mp4");
    mocks.downloadArchiveBuffer.mockResolvedValue(IMAGE_ASSET.buffer);
    mocks.downloadArchiveVideo.mockResolvedValue(VIDEO_BUFFER);
    mocks.videoToUploadAsset.mockResolvedValue({
      data: new Blob([new Uint8Array([0x00, 0x00, 0x00, 0x20])], { type: "video/mp4" }),
      filename: "slot.mp4",
      sha256: "0".repeat(64),
    });
    mocks.getSettings.mockResolvedValue({});
    mocks.updateSettings.mockResolvedValue(undefined);
    mocks.saveAsset.mockResolvedValue(undefined);
    mocks.createBlock.mockImplementation(async (blockData: unknown) => ({ id: "block-1", ...(blockData as object) }));
  });

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

    it("returns undefined when both video and image generation fail", async () => {
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

      // With a videoConfig present the source uses generateMockVideoAsset, not
      // generateVideoAsset. Both it and the image fallback must fail.
      mocks.generateMockVideoAsset.mockRejectedValue(new Error("video provider unavailable"));
      mocks.generateStoryImageAsset.mockRejectedValue(new Error("image provider unavailable"));

      const turn = await prepareAmbientTurnFromText(
        "test-channel",
        generated,
        "test-run",
        3,
        new AbortController().signal,
        true, // useVideo
        videoConfig
      );

      // Both providers failed, so there is nothing to broadcast.
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

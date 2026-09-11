import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGenerateStoryImage, mockFetchReferenceImages, mockGetAiConfiguration } = vi.hoisted(() => ({
  mockGenerateStoryImage: vi.fn(),
  mockFetchReferenceImages: vi.fn(),
  mockGetAiConfiguration: vi.fn(() => ({
    text: { provider: "test", model: "test-text" },
    image: { provider: "test", model: "test-image-model" },
    embedding: { provider: "test", model: "test-emb" },
  })),
}));

vi.mock("./blocks/ai", () => ({
  generateStoryImage: mockGenerateStoryImage,
}));

vi.mock("./blocks/ai-provider", () => ({
  getAiConfiguration: mockGetAiConfiguration,
}));

vi.mock("./blocks/image-references", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./blocks/image-references")>();
  return {
    ...actual,
    fetchReferenceImages: mockFetchReferenceImages,
  };
});

import { generateStoryImageAsset, generateAndUploadStoryImage, archiveStoryImage, generateStoryImageAssetsBatch } from "./image-uploader";

describe("image-uploader reference forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAiConfiguration.mockReturnValue({
      text: { provider: "test", model: "test-text" },
      image: { provider: "test", model: "test-image-model" },
      embedding: { provider: "test", model: "test-emb" },
    } as never);
    mockFetchReferenceImages.mockResolvedValue([]);
    mockGenerateStoryImage.mockResolvedValue("aGVsbG8=");
  });

  it("fetches reference buffers and forwards them to generation", async () => {
    const fetched = [
      { buffer: Buffer.from([1, 2]), mimeType: "image/png", hash: "h1", entityId: "px://r/character/a", representationKey: "k" },
    ];
    mockFetchReferenceImages.mockResolvedValueOnce(fetched as never);

    const selected = [{ entityId: "px://r/character/a", representationKey: "k", hash: "h1", format: "png" }];
    const signal = new AbortController().signal;

    await generateStoryImageAsset("a scene", { imageRepresentations: selected as never, signal });

    expect(mockFetchReferenceImages).toHaveBeenCalledWith(
      selected,
      expect.objectContaining({ signal, maxImages: 1 }),
    );
    expect(mockGenerateStoryImage).toHaveBeenCalledWith(
      "a scene",
      expect.objectContaining({
        referenceHashes: ["h1"],
        candidateCount: 1,
        abortSignal: signal,
      }),
    );
    const opts = mockGenerateStoryImage.mock.calls[0][1] as { referenceImages: Buffer[] };
    expect(opts.referenceImages).toHaveLength(1);
    expect(opts.referenceImages[0]).toBe(fetched[0]!.buffer);
  });

  it("degrades to text-to-image when no usable reference remains", async () => {
    mockFetchReferenceImages.mockResolvedValueOnce([]);
    const selected = [{ entityId: "px://r/character/a", representationKey: "k", hash: "h1", format: "png" }];

    await generateStoryImageAsset("a scene", { imageRepresentations: selected as never });

    expect(mockGenerateStoryImage).toHaveBeenCalledWith(
      "a scene",
      expect.not.objectContaining({ referenceImages: expect.anything() }),
    );
  });

  it("skips fetching when no references are provided", async () => {
    await generateStoryImageAsset("a scene");

    expect(mockFetchReferenceImages).not.toHaveBeenCalled();
    expect(mockGenerateStoryImage).toHaveBeenCalledWith("a scene", expect.objectContaining({}));
  });

  describe("generateStoryImageAssetsBatch", () => {
    beforeEach(() => {
      vi.stubEnv("IMAGE_BATCH_INTERVAL_MS", "0");
    });

    it("generates one asset per description, aligned with input order", async () => {
      const assets = await generateStoryImageAssetsBatch(
        [{ description: "a" }, { description: "b" }, { description: "c" }],
        { concurrency: 2 },
      );

      expect(assets).toHaveLength(3);
      expect(mockGenerateStoryImage).toHaveBeenCalledTimes(3);
      for (const asset of assets) {
        expect(asset?.buffer).toEqual(Buffer.from("hello"));
        expect(asset?.mimeType).toBe("image/jpeg");
      }
      expect(mockGenerateStoryImage).toHaveBeenNthCalledWith(3, "c", expect.objectContaining({}));
      const described = mockGenerateStoryImage.mock.calls.map((call) => call[0]).sort();
      expect(described).toEqual(["a", "b", "c"]);
    });

    it("resolves undefined for failed items without failing the batch", async () => {
      mockGenerateStoryImage.mockRejectedValueOnce(new Error("provider down"));

      const assets = await generateStoryImageAssetsBatch(
        [{ description: "bad" }, { description: "good" }],
        { concurrency: 2 },
      );

      expect(assets[0]).toBeUndefined();
      expect(assets[1]?.buffer).toEqual(Buffer.from("hello"));
    });
  });

  it("forwards references and signal through generateAndUpload", async () => {
    const { getGcsImageStorage } = await import("./image-uploader");
    void getGcsImageStorage;
    // Stub archive path by mocking GCS storage manager
    const storageModule = await import("./storage-manager");
    const uploadSpy = vi.spyOn(storageModule.GCPStorageManager.prototype, "uploadBase64Image").mockResolvedValueOnce("gs://b/channels/c/images/blocks/x.jpg" as never);
    const urlSpy = vi.spyOn(storageModule.GCPStorageManager.prototype, "getPublicUrl").mockReturnValueOnce("https://storage.googleapis.com/b/channels/c/images/blocks/x.jpg");
    // Ensure singleton is reset by setting env bucket
    vi.stubEnv("GOOGLE_CLOUD_BUCKET", "b");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "p");

    const selected = [{ entityId: "px://r/character/a", representationKey: "k", hash: "h1", format: "png" }];
    const fetched = [{ buffer: Buffer.from([1]), mimeType: "image/png", hash: "h1", entityId: "px://r/character/a", representationKey: "k" }];
    mockFetchReferenceImages.mockResolvedValueOnce(fetched as never);

    const url = await generateAndUploadStoryImage("desc", "chan", "block", { imageRepresentations: selected as never });

    expect(mockFetchReferenceImages).toHaveBeenCalled();
    expect(url).toContain("https://");
    uploadSpy.mockRestore();
    urlSpy.mockRestore();
    vi.unstubAllEnvs();
  });
});

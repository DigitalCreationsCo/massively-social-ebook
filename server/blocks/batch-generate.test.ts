import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateBlock,
  mockGenerateStoryBlock,
  mockGenerateStoryImageAssetsBatch,
  mockArchiveStoryImage,
} = vi.hoisted(() => ({
  mockCreateBlock: vi.fn(),
  mockGenerateStoryBlock: vi.fn(),
  mockGenerateStoryImageAssetsBatch: vi.fn(),
  mockArchiveStoryImage: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: { createBlock: mockCreateBlock },
}));

vi.mock("./ai", () => ({
  generateStoryBlock: mockGenerateStoryBlock,
}));

vi.mock("../image-uploader", () => ({
  archiveStoryImage: mockArchiveStoryImage,
  generateStoryImageAssetsBatch: mockGenerateStoryImageAssetsBatch,
}));

import { batchGenerateBlocks } from "./batch-generate";

function storyBlock(n: number) {
  return { title: `Title ${n}`, content: `Content ${n} `.repeat(20) };
}

describe("batchGenerateBlocks two-phase flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let n = 0;
    mockGenerateStoryBlock.mockImplementation(async () => storyBlock(++n));
    mockGenerateStoryImageAssetsBatch.mockImplementation(async (items: Array<{ description: string }>) =>
      items.map((_, i) => ({ buffer: Buffer.from(`img${i}`), mimeType: "image/jpeg", filename: `s${i}.jpg` })),
    );
    mockArchiveStoryImage.mockImplementation(async (asset: { buffer: Buffer }) =>
      `https://cdn.example.com/${asset.buffer.toString()}.jpg`,
    );
    mockCreateBlock.mockResolvedValue({ id: 1 });
  });

  it("generates text sequentially, batches images once, and persists aligned urls", async () => {
    const result = await batchGenerateBlocks("chan", 7, "prev", { blockCount: 3 });

    expect(result).toMatchObject({ blocksGenerated: 3, blocksFailed: 0 });
    expect(mockGenerateStoryBlock).toHaveBeenCalledTimes(3);
    // Narrative continuity: each text call threads the previous block's content.
    expect(mockGenerateStoryBlock).toHaveBeenNthCalledWith(1, "chan", "prev", false, 7);
    expect(mockGenerateStoryImageAssetsBatch).toHaveBeenCalledOnce();
    expect(mockGenerateStoryImageAssetsBatch.mock.calls[0][0]).toHaveLength(3);
    expect(mockArchiveStoryImage).toHaveBeenCalledTimes(3);
    expect(mockCreateBlock).toHaveBeenCalledTimes(3);
    expect(mockCreateBlock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ title: "Title 1", imageUrl: "https://cdn.example.com/img0.jpg" }),
      false,
    );
    expect(mockCreateBlock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ title: "Title 3", imageUrl: "https://cdn.example.com/img2.jpg" }),
      false,
    );
  });

  it("persists blocks with null imageUrl when their image fails", async () => {
    mockGenerateStoryImageAssetsBatch.mockResolvedValueOnce([
      { buffer: Buffer.from("img0"), mimeType: "image/jpeg", filename: "s0.jpg" },
      undefined,
    ]);

    const result = await batchGenerateBlocks("chan", 7, "", { blockCount: 2 });

    expect(result).toMatchObject({ blocksGenerated: 2, blocksFailed: 0 });
    expect(mockCreateBlock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ imageUrl: "https://cdn.example.com/img0.jpg" }),
      false,
    );
    expect(mockCreateBlock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ imageUrl: null }),
      false,
    );
  });

  it("aborts before the image phase when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));

    const result = await batchGenerateBlocks("chan", 7, "", { blockCount: 2, signal: controller.signal });

    expect(result.blocksGenerated).toBe(0);
    expect(mockGenerateStoryImageAssetsBatch).not.toHaveBeenCalled();
    expect(mockCreateBlock).not.toHaveBeenCalled();
    expect(result.errors.join()).toMatch(/Cancelled/);
  });
});

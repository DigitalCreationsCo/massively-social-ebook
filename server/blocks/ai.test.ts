import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGenerateText,
  mockGenerateImage,
  mockGetLanguageModel,
  mockGetImageModel,
  mockGenerateContext,
} = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockGenerateImage: vi.fn(),
  mockGetLanguageModel: vi.fn(() => ({ provider: "test" })),
  mockGetImageModel: vi.fn(() => ({ provider: "test" })),
  mockGenerateContext: vi.fn((_channelId: string, immediateContext: string) =>
    Promise.resolve(immediateContext),
  ),
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  generateImage: mockGenerateImage,
  Output: { object: vi.fn((definition: unknown) => definition) },
}));

vi.mock("./ai-provider", () => ({
  getAiConfiguration: () => ({
    text: { provider: "test", model: "test-text-model" },
    image: { provider: "test", model: "test-image-model" },
  }),
  getLanguageModel: mockGetLanguageModel,
  getImageModel: mockGetImageModel,
}));

vi.mock("./rag", () => ({ RagProvider: class {} }));

vi.mock("@portalshq/narrativeengine", () => ({
  NarrativeEngine: class {
    generateContext = mockGenerateContext;
  },
  configureLabEngine: vi.fn(),
}));

import { generateStoryBlock, generateStoryImage } from "./ai";

describe("AI Generators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateContext.mockImplementation((_channelId: string, immediateContext: string) =>
      Promise.resolve(immediateContext),
    );
  });

  describe("generateStoryBlock", () => {
    it("generates a validated story block through the configured language model", async () => {
      mockGenerateText.mockResolvedValueOnce({
        output: {
          title: "Test Title",
          content: "Test content here.",
          optionA: { label: "A", description: "desc A" },
          optionB: { label: "B", description: "desc B" },
          isNotable: false,
        },
      });

      const result = await generateStoryBlock("scifi", "Previous block text");

      expect(mockGenerateText).toHaveBeenCalledTimes(1);
      expect(mockGetLanguageModel).toHaveBeenCalledTimes(1);
      expect(mockGenerateText.mock.calls[0][0].instructions).toContain(
        "Characters don't make stupid decisions",
      );
      expect(mockGenerateText.mock.calls[0][0].prompt).toContain("Current story context:");
      expect(result.title).toBe("Test Title");
      expect(result.content).toBe("Test content here.");
      expect(result.optionA?.label).toBe("A");
      expect(result.optionB?.label).toBe("B");
    });

    it("throws when the provider returns no structured output", async () => {
      mockGenerateText.mockResolvedValueOnce({ output: undefined });

      await expect(generateStoryBlock("scifi", "Previous context")).rejects.toThrow(
        "Failed to generate story block: No structured output returned.",
      );
    });

    it("calls NarrativeEngine.generateContext with the channel and previous context", async () => {
      mockGenerateText.mockResolvedValueOnce({
        output: { title: "RAG Title", content: "RAG content", isNotable: false },
      });

      await generateStoryBlock("mystery", "The detective investigated.");

      expect(mockGenerateContext).toHaveBeenCalledWith(
        "mystery",
        "The detective investigated.",
      );
    });

    it("includes enriched RAG context in the AI SDK prompt", async () => {
      const enrichedContext = "Story So Far:\\n1. It began.\\n\\nCurrent Situation:\\nThe crew arrived.";
      mockGenerateContext.mockResolvedValueOnce(enrichedContext);
      mockGenerateText.mockResolvedValueOnce({
        output: { title: "Enriched Title", content: "Enriched content", isNotable: false },
      });

      await generateStoryBlock("scifi", "The crew arrived.");

      expect(mockGenerateText.mock.calls[0][0].prompt).toContain("Story So Far");
    });

    it("removes options when resolving a story", async () => {
      mockGenerateText.mockResolvedValueOnce({
        output: {
          title: "Resolution Title",
          content: "Resolution content.",
          optionA: { label: "A", description: "desc A" },
          optionB: { label: "B", description: "desc B" },
          isNotable: true,
        },
      });

      const result = await generateStoryBlock("scifi", "Previous", true);

      expect(result.optionA).toBeUndefined();
      expect(result.optionB).toBeUndefined();
      expect(result.title).toBe("Resolution Title");
    });
  });

  describe("generateStoryImage", () => {
    it("returns raw base64 from the configured image provider", async () => {
      const base64Image = "YmFzZTY0dGVzdGk=";
      mockGenerateImage.mockResolvedValueOnce({ image: { base64: base64Image } });

      const result = await generateStoryImage("A test image description");

      expect(mockGenerateImage).toHaveBeenCalledWith({
        model: expect.anything(),
        prompt: expect.any(String),
        n: 1,
        aspectRatio: "16:9",
      });
      expect(mockGetImageModel).toHaveBeenCalledTimes(1);
      expect(result).toBe(base64Image);
      expect(result).not.toContain("data:image");
    });

    it("throws when no image data is returned", async () => {
      mockGenerateImage.mockResolvedValueOnce({ image: undefined });

      await expect(generateStoryImage("A test image description")).rejects.toThrow(
        "No image data returned from the configured AI provider.",
      );
    });

    it("propagates provider errors", async () => {
      mockGenerateImage.mockRejectedValueOnce(new Error("API Error"));

      await expect(generateStoryImage("A test image description")).rejects.toThrow("API Error");
    });
  });
});

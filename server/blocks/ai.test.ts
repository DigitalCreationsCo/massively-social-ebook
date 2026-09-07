import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGenerateText,
  mockGenerateImage,
  mockGetLanguageModel,
  mockGetImageModel,
  mockGetHuggingFaceImageClient,
  imageConfiguration,
  mockBuildContext,
  mockGenerateBlocksBatch,
  mockInvalidateChannel,
  engineOptions,
} = vi.hoisted(() => ({
  engineOptions: { value: undefined as unknown },
  mockGenerateText: vi.fn(),
  mockGenerateImage: vi.fn(),
  mockGetLanguageModel: vi.fn(() => ({ provider: "test" })),
  mockGetImageModel: vi.fn(() => ({ provider: "test" })),
  mockGetHuggingFaceImageClient: vi.fn(),
  imageConfiguration: { provider: "test", model: "test-image-model" },
  mockBuildContext: vi.fn(({ inputQuery }: { inputQuery: string }) =>
    Promise.resolve({ prompt: inputQuery }),
  ),
  mockGenerateBlocksBatch: vi.fn(),
  mockInvalidateChannel: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  generateImage: mockGenerateImage,
  Output: { object: vi.fn((definition: unknown) => definition) },
}));

vi.mock("./ai-provider", () => ({
  getAiConfiguration: () => ({
    text: { provider: "test", model: "test-text-model" },
    image: imageConfiguration,
  }),
  getLanguageModel: mockGetLanguageModel,
  getImageModel: mockGetImageModel,
  getHuggingFaceImageClient: mockGetHuggingFaceImageClient,
}));

vi.mock("./rag", () => ({ RagProvider: class {} }));

vi.mock("@portalshq/narrativeengine", () => ({
  NarrativeEngine: class {
    constructor(options: unknown) { engineOptions.value = options; }
    buildContext = mockBuildContext;
    generateBlocksBatch = mockGenerateBlocksBatch;
    invalidateChannel = mockInvalidateChannel;
  },
}));

import { generateCanonicalStoryWindow, generateContextWithTimeout, generateStoryBlock, generateStoryImage } from "./ai";
import { logger } from "../logger";

describe("AI Generators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    imageConfiguration.provider = "test";
    imageConfiguration.model = "test-image-model";
    mockBuildContext.mockImplementation(({ inputQuery }: { inputQuery: string }) =>
      Promise.resolve({ prompt: inputQuery }),
    );
    mockGenerateBlocksBatch.mockImplementation(async (requests: Array<{ channelId: string; inputQuery: string; parameters: unknown }>) => {
      const options = engineOptions.value as {
        generationProvider: {
          generateBlocksBatch: (requests: Array<{ context: unknown; parameters: unknown }>) => Promise<Array<Record<string, unknown>>>;
        };
      };
      const contexts = await Promise.all(requests.map((request) => mockBuildContext(request)));
      const drafts = await options.generationProvider.generateBlocksBatch(
        requests.map((request, index) => ({ context: { ...contexts[index], channelId: request.channelId, inputQuery: request.inputQuery, entities: [] }, parameters: request.parameters })),
      );
      return drafts.map((block, index) => ({ block, context: contexts[index] }));
    });
  });

  it("configures NarrativeEngine to prefer character sheets and fall back to portraits", () => {
    expect(engineOptions.value).toMatchObject({
      config: {
        enrichmentFailureBehavior: "continue",
        preferredEntityRepresentationProperties: ["character_sheet", "portrait"],
        blockRetrieval: {
          maximumBlocks: 12,
          steps: [
            { takeNewestBlocks: 10 },
            { addNotableBlocksUntilThereAre: 3 },
          ],
        },
      },
    });
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
      expect(result.optionA).toBeUndefined();
      expect(result.optionB).toBeUndefined();
      expect(mockGenerateText.mock.calls[0][0].instructions).not.toContain("generate 2 choices");
    });

    it("emits public A/B choices only when explicitly enabled", async () => {
      vi.stubEnv("STORY_DECISION_BRANCHES", "2");
      mockGenerateText.mockResolvedValueOnce({
        output: {
          title: "Choice Title",
          content: "Choose.",
          optionA: { label: "A", description: "desc A" },
          optionB: { label: "B", description: "desc B" },
          isNotable: false,
        },
      });

      const result = await generateStoryBlock("scifi", "Previous block text");

      expect(result.optionA?.label).toBe("A");
      expect(result.optionB?.label).toBe("B");
      expect(mockGenerateText.mock.calls[0][0].instructions).toContain("generate 2 choices");
    });

    it("throws when the provider returns no structured output", async () => {
      mockGenerateText.mockResolvedValueOnce({ output: undefined });

      await expect(generateStoryBlock("scifi", "Previous context")).rejects.toThrow(
        "Failed to generate story block: No structured output returned.",
      );
    });

    it("calls NarrativeEngine.buildContext with the channel and previous context", async () => {
      mockGenerateText.mockResolvedValueOnce({
        output: { title: "RAG Title", content: "RAG content", isNotable: false },
      });

      await generateStoryBlock("25th-chapter", "The detective investigated.");

      expect(mockBuildContext).toHaveBeenCalledWith({
        channelId: "25th-chapter",
        inputQuery: "The detective investigated.",
      });
    });

    it("includes enriched RAG context in the AI SDK prompt", async () => {
      const enrichedContext = "Story So Far:\\n1. It began.\\n\\nCurrent Situation:\\nThe crew arrived.";
      mockBuildContext.mockResolvedValueOnce({ prompt: enrichedContext });
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

    it("uses NarrativeEngine.generateBlocksBatch for one dependent canonical text window", async () => {
      mockBuildContext.mockResolvedValueOnce({ prompt: "Retrieved story history" });
      mockGenerateText.mockResolvedValueOnce({ output: { blocks: [
        { title: "One", content: "First continuation.", isNotable: false },
        { title: "Two", content: "Second continuation.", isNotable: false },
      ] } });

      const blocks = await generateCanonicalStoryWindow("scifi", "Previous block.", 2, 5);

      expect(blocks.map((block) => block.content)).toEqual(["First continuation.", "Second continuation."]);
      expect(mockGenerateBlocksBatch).toHaveBeenCalledTimes(1);
      expect(mockGenerateBlocksBatch.mock.calls[0][0]).toHaveLength(2);
      expect(mockGenerateText).toHaveBeenCalledTimes(1);
      expect(mockGenerateText.mock.calls[0][0].instructions).toContain("chronological story sections");
      expect(mockInvalidateChannel).toHaveBeenCalledWith("scifi");
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
        maxRetries: 0,
      });
      expect(mockGetImageModel).toHaveBeenCalledTimes(1);
      expect(result).toBe(base64Image);
      expect(result).not.toContain("data:image");
    });

    it("does not retry image generation internally when broadcast can use an archived fallback", async () => {
      mockGenerateImage.mockResolvedValueOnce({ image: { base64: "eA==" } });

      await generateStoryImage("A scene");

      expect(mockGenerateImage).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
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

    it("passes reference buffers as prompt.images", async () => {
      const base64Image = "YmFzZTY0dGVzdGk=";
      mockGenerateImage.mockResolvedValueOnce({ image: { base64: base64Image } });
      const refs = [Buffer.from([1, 2, 3])];

      await generateStoryImage("A scene", { referenceImages: refs, referenceHashes: ["hash-1"], candidateCount: 1 });

      expect(mockGenerateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.objectContaining({ text: expect.any(String), images: expect.any(Array) }),
        }),
      );
      const prompt = mockGenerateImage.mock.calls.at(-1)![0].prompt as { text: string; images: unknown[] };
      expect(prompt.images).toHaveLength(1);
      expect(prompt.images[0]).toBe(refs[0]);
    });

    it("enforces unknown-model limit of one reference", async () => {
      mockGenerateImage.mockResolvedValueOnce({ image: { base64: "eA==" } });
      const refs = [Buffer.from([1]), Buffer.from([2]), Buffer.from([3])];

      await generateStoryImage("A scene", { referenceImages: refs, candidateCount: 3 });

      const prompt = mockGenerateImage.mock.calls.at(-1)![0].prompt as { text: string; images: unknown[] };
      // test-image-model is unknown -> conservatively one reference
      expect(prompt.images).toHaveLength(1);
    });

    it("uses text-only prompt when no usable reference remains", async () => {
      mockGenerateImage.mockResolvedValueOnce({ image: { base64: "eA==" } });

      await generateStoryImage("A scene", { referenceImages: [], candidateCount: 2 });

      expect(mockGenerateImage).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: expect.any(String) }),
      );
    });

    it("forwards the broadcast abort signal to generation", async () => {
      mockGenerateImage.mockResolvedValueOnce({ image: { base64: "eA==" } });
      const controller = new AbortController();

      await generateStoryImage("A scene", { abortSignal: controller.signal });

      expect(mockGenerateImage).toHaveBeenCalledWith(expect.objectContaining({ abortSignal: controller.signal }));
    });

    it("uses Hugging Face FLUX.2 through fal-ai and converts its Blob response to raw base64", async () => {
      imageConfiguration.provider = "huggingface";
      imageConfiguration.model = "black-forest-labs/FLUX.2-dev";
      const imageTextToImage = vi.fn().mockResolvedValue(new Blob([Buffer.from("hf-image")]));
      mockGetHuggingFaceImageClient.mockReturnValue({ imageTextToImage });
      const controller = new AbortController();

      const result = await generateStoryImage("A scene", {
        referenceImages: [Buffer.from([1, 2, 3]), Buffer.from([4, 5, 6])],
        abortSignal: controller.signal,
      });

      expect(imageTextToImage).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "fal-ai",
          model: "black-forest-labs/FLUX.2-dev",
          parameters: expect.objectContaining({ target_size: { width: 1536, height: 864 } }),
        }),
        expect.objectContaining({ retry_on_error: false, signal: controller.signal }),
      );
      const request = imageTextToImage.mock.calls[0][0] as { inputs: Blob };
      expect(Buffer.from(await request.inputs.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
      expect(result).toBe(Buffer.from("hf-image").toString("base64"));
      expect(mockGenerateImage).not.toHaveBeenCalled();
    });
  });

  describe("generateContextWithTimeout / StoryBlockResult context", () => {
    it("returns full context and selected nested references", async () => {
      mockBuildContext.mockResolvedValueOnce({
        prompt: "enriched prompt",
        entities: [
          {
            id: "nap://repo/character/hero",
            name: "Hero",
            type: "character",
            representations: {
              reference_image: { hash: "hash-hero", format: "png", uri: "https://storage.googleapis.com/b/hero.png" },
            },
          },
        ],
        representations: [{ hash: "deprecated", uri: "https://evil.test/deprecated.png" }],
      });
      mockGenerateText.mockResolvedValueOnce({
        output: { title: "T", content: "C", isNotable: false },
      });

      const result = await generateStoryBlock("chan", "prev");

      expect(result.narrativeContext).toBeDefined();
      expect(result.imageRepresentations).toHaveLength(1);
      expect(result.selectedImageRepresentations).toHaveLength(1);
      expect(result.imageRepresentations?.[0]).toMatchObject({
        entityId: "nap://repo/character/hero",
        representationKey: "reference_image",
        hash: "hash-hero",
      });
      // Deprecated top-level list is never used as the source.
      expect(result.imageRepresentations?.[0]?.hash).not.toBe("deprecated");
    });

    it("returns neither context nor references when PX enrichment fails", async () => {
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      mockBuildContext.mockRejectedValueOnce(new Error("PX failed"));
      mockGenerateText.mockResolvedValueOnce({
        output: { title: "T", content: "C", isNotable: false },
      });

      const result = await generateStoryBlock("chan", "prev");

      expect(result.narrativeContext).toBeUndefined();
      expect(result.imageRepresentations).toBeUndefined();
      expect(result.selectedImageRepresentations).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        "[NLP] Circuit breaker triggered, falling back to immediate context",
        "blocks",
        expect.objectContaining({ message: "PX failed" }),
        expect.objectContaining({ channelId: "chan" }),
      );
      warn.mockRestore();
    });

    it("rejects after the bounded context timeout", async () => {
      vi.useFakeTimers();
      try {
        mockBuildContext.mockImplementationOnce(() => new Promise(() => undefined));
        const pending = generateContextWithTimeout("chan", "q");
        const assertion = expect(pending).rejects.toThrow("Context generation timeout (>12000ms)");
        await vi.advanceTimersByTimeAsync(12000);
        await assertion;
      } finally {
        vi.useRealTimers();
        mockBuildContext.mockImplementation(({ inputQuery }: { inputQuery: string }) =>
          Promise.resolve({ prompt: inputQuery }),
        );
      }
    });
  });
});

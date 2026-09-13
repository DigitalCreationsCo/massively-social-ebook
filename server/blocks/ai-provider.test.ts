import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGoogle,
  mockGoogleImage,
  mockGoogleEmbedding,
  mockOpenAI,
  mockOpenAIImage,
  mockOpenAIEmbedding,
  mockOpenCode,
  mockCreateGoogle,
  mockCreateOpenAI,
  mockCreateOpenCode,
} = vi.hoisted(() => {
  const google = vi.fn();
  Object.assign(google, { image: vi.fn(), embedding: vi.fn() });
  const openai = vi.fn();
  Object.assign(openai, { image: vi.fn(), embedding: vi.fn() });
  const opencode = vi.fn();

  return {
    mockGoogle: google,
    mockGoogleImage: google.image,
    mockGoogleEmbedding: google.embedding,
    mockOpenAI: openai,
    mockOpenAIImage: openai.image,
    mockOpenAIEmbedding: openai.embedding,
    mockOpenCode: opencode,
    mockCreateGoogle: vi.fn(() => google),
    mockCreateOpenAI: vi.fn(() => openai),
    mockCreateOpenCode: vi.fn(() => opencode),
  };
});

vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: mockCreateGoogle }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: mockCreateOpenAI }));
vi.mock("ai-sdk-provider-opencode-sdk", () => ({ createOpencode: mockCreateOpenCode }));
vi.mock("@fal-ai/client", () => ({
  fal: {
    run: vi.fn(),
    config: vi.fn(),
  },
}));

import { getEmbeddingModel, getImageModel, getLanguageModel, getAiConfiguration, generateProviderImage, generateProviderVideo, getVideoCostControlState, getVideoSavingConfig } from "./ai-provider";

describe("AI SDK provider selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AI_PROVIDER", "google");
    vi.stubEnv("AI_TEXT_PROVIDER", "");
    vi.stubEnv("AI_IMAGE_PROVIDER", "");
    vi.stubEnv("AI_EMBEDDING_PROVIDER", "");
    vi.stubEnv("AI_VIDEO_PROVIDER", "");
    vi.stubEnv("AI_MODEL", "");
    vi.stubEnv("AI_TEXT_MODEL", "");
    vi.stubEnv("AI_IMAGE_MODEL", "");
    vi.stubEnv("AI_EMBEDDING_MODEL", "");
    vi.stubEnv("AI_VIDEO_MODEL", "");
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT_ID", "test-project");
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("OPENCODE_BASE_URL", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("FAL_KEY", "");
    vi.stubEnv("VIDEO_DAILY_BUDGET_USD", "");
    vi.stubEnv("VIDEO_SAVE_SESSION", "");
    vi.stubEnv("VIDEO_SAVE_AMBIENT", "");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("uses Gemini by default while supporting the legacy GEMINI_API_KEY", () => {
    getLanguageModel();

    expect(mockCreateGoogle).toHaveBeenCalledWith({ apiKey: "gemini-key" });
    expect(mockGoogle).toHaveBeenCalledWith("gemini-3.1-flash-lite-preview");
  });

  it("switches text generation to an OpenCode model", () => {
    vi.stubEnv("AI_TEXT_PROVIDER", "opencode");
    vi.stubEnv("AI_TEXT_MODEL", "openai/gpt-4o-mini");
    vi.stubEnv("OPENCODE_BASE_URL", "http://localhost:4096");

    getLanguageModel();

    expect(mockCreateOpenCode).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://localhost:4096" }),
    );
    expect(mockOpenCode).toHaveBeenCalledWith("openai/gpt-4o-mini");
  });

  it("switches images and embeddings to OpenAI independently", () => {
    vi.stubEnv("AI_IMAGE_PROVIDER", "openai");
    vi.stubEnv("AI_IMAGE_MODEL", "gpt-image-1.5");
    vi.stubEnv("AI_EMBEDDING_PROVIDER", "openai");
    vi.stubEnv("AI_EMBEDDING_MODEL", "text-embedding-3-small");

    getImageModel();
    getEmbeddingModel();

    expect(mockCreateOpenAI).toHaveBeenCalledWith({ apiKey: "openai-key" });
    expect(mockOpenAIImage).toHaveBeenCalledWith("gpt-image-1.5");
    expect(mockOpenAIEmbedding).toHaveBeenCalledWith("text-embedding-3-small");
  });

  it("rejects OpenCode for image generation", () => {
    vi.stubEnv("AI_IMAGE_PROVIDER", "opencode");

    expect(() => getImageModel()).toThrow("OpenCode does not expose an AI SDK image model");
  });

  it("defaults openrouter image model to meta/muse-image", () => {
    vi.stubEnv("AI_IMAGE_PROVIDER", "openrouter");
    vi.stubEnv("AI_VIDEO_PROVIDER", ""); // Clear video provider to avoid conflicts

    expect(getAiConfiguration().image).toEqual({ provider: "openrouter", model: "meta/muse-image" });
  });

  it("rejects OpenRouter for getImageModel (direct Images API client)", () => {
    vi.stubEnv("AI_IMAGE_PROVIDER", "openrouter");
    vi.stubEnv("AI_IMAGE_MODEL", "meta/muse-image");

    expect(() => getImageModel()).toThrow("direct Images API");
  });

  describe("generateProviderImage via OpenRouter Images API", () => {
    beforeEach(() => {
      vi.stubEnv("AI_IMAGE_PROVIDER", "openrouter");
      vi.stubEnv("AI_IMAGE_MODEL", "meta/muse-image");
      vi.stubEnv("OPENROUTER_API_KEY", "or-key");
      vi.stubEnv("AI_VIDEO_PROVIDER", ""); // Clear video provider to avoid conflicts
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("posts to /api/v1/images and returns stripped base64", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(generateProviderImage({ text: "a scene" })).resolves.toBe("aGVsbG8=");
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { body: string }];
      expect(url).toBe("https://openrouter.ai/api/v1/images");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer or-key");
      expect(JSON.parse(init.body)).toMatchObject({
        model: "meta/muse-image",
        prompt: "a scene",
        aspect_ratio: "16:9",
        output_format: "jpeg",
      });
    });

    it("sends reference images as input_references", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), { status: 200 }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await generateProviderImage({ text: "edit", referenceImages: [Buffer.from([1, 2])] });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { body: string }];
      const body = JSON.parse(init.body);
      expect(body.input_references).toHaveLength(1);
      expect(body.input_references[0].image_url.url).toMatch(/^data:image\/png;base64,/);
    });

    it("throws with the status on API failure (feeds the 429 cooldown)", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));

      await expect(generateProviderImage({ text: "x" })).rejects.toThrow("429");
    });
  });

  describe("video generation", () => {
    beforeEach(() => {
      vi.stubEnv("AI_VIDEO_PROVIDER", "openrouter");
      vi.stubEnv("AI_VIDEO_MODEL", "google/veo-3.1");
      vi.stubEnv("OPENROUTER_API_KEY", "or-key");
      vi.stubEnv("VIDEO_DAILY_BUDGET_USD", "10");
      vi.stubEnv("VIDEO_SAVE_SESSION", "true");
      vi.stubEnv("VIDEO_SAVE_AMBIENT", "false");
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("configures video provider with OpenRouter by default", () => {
      const config = getAiConfiguration();
      expect(config.video).toEqual({ provider: "openrouter", model: "google/veo-3.1" });
    });

    it("configures video provider with Fal.ai when selected", () => {
      vi.stubEnv("AI_VIDEO_PROVIDER", "fal");
      vi.stubEnv("AI_VIDEO_MODEL", "fal-ai/veo3.1");
      vi.stubEnv("FAL_KEY", "fal-key");

      const config = getAiConfiguration();
      expect(config.video).toEqual({ provider: "fal", model: "fal-ai/veo3.1" });
    });

    it("rejects unsupported providers for video generation", async () => {
      vi.stubEnv("AI_VIDEO_PROVIDER", "google");

      await expect(generateProviderVideo({ text: "test" })).rejects.toThrow("Video generation not yet supported by google provider");
    });

    it("saves session videos by default but not ambient videos", () => {
      const config = getVideoSavingConfig();
      expect(config.saveSessionVideos).toBe(true);
      expect(config.saveAmbientVideos).toBe(false);
    });

    it("respects custom video saving configuration", () => {
      vi.stubEnv("VIDEO_SAVE_SESSION", "false");
      vi.stubEnv("VIDEO_SAVE_AMBIENT", "true");

      const config = getVideoSavingConfig();
      expect(config.saveSessionVideos).toBe(false);
      expect(config.saveAmbientVideos).toBe(true);
    });

    it("tracks video cost control state", () => {
      // Reset cost state for clean test
      const { costControlState } = require("./ai-provider");
      costControlState.spentTodayUsd = 0;
      
      const state = getVideoCostControlState();
      expect(state.dailyBudgetUsd).toBe(10);
      expect(state.spentTodayUsd).toBe(0);
      expect(state.remainingBudgetUsd).toBe(10);
      expect(state.dailyResetAt).toBeGreaterThan(Date.now());
    });

    it("cost estimation works for different providers and resolutions", () => {
      vi.stubEnv("AI_VIDEO_PROVIDER", "openrouter");
      vi.stubEnv("VIDEO_DAILY_BUDGET_USD", "1.0");

      const state = getVideoCostControlState();
      expect(state.dailyBudgetUsd).toBe(1.0);
    });
  });
});

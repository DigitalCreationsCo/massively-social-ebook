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

import { getEmbeddingModel, getImageModel, getLanguageModel, getAiConfiguration, generateProviderImage } from "./ai-provider";

describe("AI SDK provider selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AI_PROVIDER", "google");
    vi.stubEnv("AI_TEXT_PROVIDER", "");
    vi.stubEnv("AI_IMAGE_PROVIDER", "");
    vi.stubEnv("AI_EMBEDDING_PROVIDER", "");
    vi.stubEnv("AI_MODEL", "");
    vi.stubEnv("AI_TEXT_MODEL", "");
    vi.stubEnv("AI_IMAGE_MODEL", "");
    vi.stubEnv("AI_EMBEDDING_MODEL", "");
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("OPENCODE_BASE_URL", "");
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
});

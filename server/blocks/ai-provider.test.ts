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

import { getEmbeddingModel, getImageModel, getLanguageModel } from "./ai-provider";

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
});

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpencode } from "ai-sdk-provider-opencode-sdk";
import type { EmbeddingModel, ImageModel, LanguageModel } from "ai";

/** Providers that can be selected through the AI_*_PROVIDER environment variables. */
export type AiProvider = "google" | "openai" | "opencode";
type AiCapability = "text" | "image" | "embedding";

const DEFAULT_MODELS: Record<AiProvider, Record<AiCapability, string | undefined>> = {
  google: {
    text: "gemini-3.7-flash",
    image: "gemini-2.5-flash-image",
    embedding: "gemini-embedding-001",
  },
  openai: {
    text: "gpt-5.6-luna",
    image: "gpt-image-1.5",
    embedding: "text-embedding-3-small",
  },
  // OpenCode's community AI SDK provider currently exposes language models only.
  opencode: {
    text: "ling-3.0-flash-fin-free",
    image: undefined,
    embedding: undefined,
  },
};

function requireEnvironmentVariable(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }

  throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
}

function configuredProvider(capability: AiCapability): AiProvider {
  const configuredValue =
    process.env[`AI_${capability.toUpperCase()}_PROVIDER`] ??
    process.env.AI_PROVIDER;
  const configured = (configuredValue || "google").trim().toLowerCase();

  if (configured === "gemini") return "google";
  if (configured === "google" || configured === "openai" || configured === "opencode") {
    return configured;
  }

  throw new Error(
    `Unsupported AI provider "${configured}". Use google, openai, or opencode.`,
  );
}

function configuredModel(capability: AiCapability, provider: AiProvider): string {
  const configuredModel =
    process.env[`AI_${capability.toUpperCase()}_MODEL`] ??
    (capability === "text" ? process.env.AI_MODEL : undefined);
  const model =
    configuredModel?.trim() ||
    DEFAULT_MODELS[provider][capability];

  if (!model) {
    throw new Error(
      `AI ${capability} generation is not supported by the ${provider} provider. ` +
        `Choose a supported AI_${capability.toUpperCase()}_PROVIDER.`,
    );
  }

  return model;
}

function googleProvider() {
  // GEMINI_API_KEY is retained as a backwards-compatible alias.
  return createGoogleGenerativeAI({
    apiKey: requireEnvironmentVariable("GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"),
  });
}

function openaiProvider() {
  return createOpenAI({ apiKey: requireEnvironmentVariable("OPENAI_API_KEY") });
}

function opencodeProvider() {
  const timeout = Number.parseInt(process.env.OPENCODE_SERVER_TIMEOUT_MS ?? "10000", 10);
  return createOpencode({
    baseUrl: process.env.OPENCODE_BASE_URL,
    autoStartServer: process.env.OPENCODE_AUTO_START_SERVER !== "false",
    serverTimeout: Number.isFinite(timeout) ? timeout : 10_000,
  });
}

/** Returns the language model selected by AI_TEXT_PROVIDER and AI_TEXT_MODEL. */
export function getLanguageModel(): LanguageModel {
  const provider = configuredProvider("text");
  const model = configuredModel("text", provider);

  switch (provider) {
    case "google":
      return googleProvider()(model);
    case "openai":
      return openaiProvider()(model);
    case "opencode":
      return opencodeProvider()(model);
  }
}

/** Returns an image model selected by AI_IMAGE_PROVIDER and AI_IMAGE_MODEL. */
export function getImageModel(): ImageModel {
  const provider = configuredProvider("image");
  if (provider === "opencode") {
    throw new Error(
      "OpenCode does not expose an AI SDK image model. Set AI_IMAGE_PROVIDER to google or openai.",
    );
  }

  const model = configuredModel("image", provider);

  switch (provider) {
    case "google":
      return googleProvider().image(model);
    case "openai":
      return openaiProvider().image(model);
  }
}

/** Returns an embedding model selected by AI_EMBEDDING_PROVIDER and AI_EMBEDDING_MODEL. */
export function getEmbeddingModel(): EmbeddingModel {
  const provider = configuredProvider("embedding");
  if (provider === "opencode") {
    throw new Error(
      "OpenCode does not expose an AI SDK embedding model. Set AI_EMBEDDING_PROVIDER to google or openai.",
    );
  }

  const model = configuredModel("embedding", provider);

  switch (provider) {
    case "google":
      return googleProvider().embedding(model);
    case "openai":
      return openaiProvider().embedding(model);
  }
}

/** The active resolved configuration, useful for diagnostics and tests. */
export function getAiConfiguration() {
  const textProvider = configuredProvider("text");
  const imageProvider = configuredProvider("image");
  const embeddingProvider = configuredProvider("embedding");

  return {
    text: { provider: textProvider, model: configuredModel("text", textProvider) },
    image: { provider: imageProvider, model: configuredModel("image", imageProvider) },
    embedding: {
      provider: embeddingProvider,
      model: configuredModel("embedding", embeddingProvider),
    },
  };
}

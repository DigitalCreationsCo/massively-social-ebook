import { createGoogleVertex } from "@ai-sdk/google-vertex";
import { createOpenAI } from "@ai-sdk/openai";
import { GoogleGenAI } from "@google/genai";
import { InferenceClient } from "@huggingface/inference";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpencode } from "ai-sdk-provider-opencode-sdk";
import { generateImage, type EmbeddingModel, type ImageModel, type LanguageModel } from "ai";

/** Providers that can be selected through the AI_*_PROVIDER environment variables. */
export type AiProvider = "google" | "openai" | "opencode" | "huggingface" | "openrouter";
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
    text: "opencode/ling-3.0-flash-fin-free",
    image: undefined,
    embedding: undefined,
  },
  huggingface: {
    text: undefined,
    image: "black-forest-labs/FLUX.2-dev",
    embedding: undefined,
  },
  openrouter: {
    text: "minimax/minimax-m3:free",
    image: "meta/muse-image",
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
  if (configured === "hf") return "huggingface";
  if (
    configured === "google" || configured === "openai" || configured === "opencode" ||
    configured === "huggingface" || configured === "openrouter"
  ) {
    return configured;
  }

  throw new Error(
    `Unsupported AI provider "${configured}". Use google, openai, opencode, huggingface, or openrouter.`,
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
  return createGoogleVertex({
    project: requireEnvironmentVariable("GOOGLE_CLOUD_PROJECT_ID"),
  });
}

function openaiProvider() {
  return createOpenAI({ apiKey: requireEnvironmentVariable("OPENAI_API_KEY") });
}

function openrouterProvider() {
  return createOpenRouter({ apiKey: requireEnvironmentVariable("OPENROUTER_API_KEY") });
}

function opencodeProvider() {
  const timeout = Number.parseInt(process.env.OPENCODE_SERVER_TIMEOUT_MS ?? "10000", 10);
  return createOpencode(
    // {
    // baseUrl: process.env.OPENCODE_BASE_URL,
    // autoStartServer: process.env.OPENCODE_AUTO_START_SERVER !== "false",
    // serverTimeout: Number.isFinite(timeout) ? timeout : 10_000,
    // }
  );
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
    case "huggingface":
      throw new Error("Hugging Face is currently available only for AI_IMAGE_PROVIDER.");
    case "openrouter":
      return openrouterProvider()(model);
  }
}

function getHuggingFaceImageClient(): InferenceClient {
  return new InferenceClient(requireEnvironmentVariable("HF_TOKEN"));
}

function getGoogleGenAiImageClient(): GoogleGenAI {
  return new GoogleGenAI({
    vertexai: true,
    project: requireEnvironmentVariable("GOOGLE_CLOUD_PROJECT_ID", "GOOGLE_CLOUD_PROJECT"),
    location: process.env.GOOGLE_VERTEX_LOCATION?.trim() || "global",
  });
}

/**
 * OpenRouter dedicated Images API (`POST /api/v1/images`).
 *
 * The installed `@openrouter/ai-sdk-provider` (v3) routes `imageModel()` through
 * `/chat/completions`, which Images-API-only models like `meta/muse-image` do not
 * serve — so OpenRouter image generation goes through this direct client instead
 * (same pattern as the Hugging Face direct client below).
 */
const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";

function sniffImageMime(buffer: Uint8Array | Buffer): string | undefined {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return "image/webp";
  return undefined;
}

function resolveReferenceMimeType(image: NonNullable<ProviderImageRequest["referenceImages"]>[number], explicit?: string): string {
  if (explicit) {
    const t = explicit.trim().toLowerCase();
    if (t) return t;
  }
  if (typeof image === "string") {
    const m = image.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
    if (m) return m[1]!.toLowerCase();
    return "image/png";
  }
  const bytes = image instanceof ArrayBuffer ? new Uint8Array(image) : image as Uint8Array | Buffer;
  return sniffImageMime(bytes as Uint8Array) ?? "image/png";
}

function openRouterReferenceDataUrl(image: NonNullable<ProviderImageRequest["referenceImages"]>[number], mimeType?: string): string {
  if (typeof image === "string") {
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(image)) return image;
    return `data:${mimeType ?? "image/png"};base64,${image}`;
  }
  const mime = mimeType ?? sniffImageMime(Buffer.from(image instanceof ArrayBuffer ? new Uint8Array(image) : image as Uint8Array)) ?? "image/png";
  return `data:${mime};base64,${Buffer.from(image instanceof ArrayBuffer ? new Uint8Array(image) : image).toString("base64")}`;
}

async function generateOpenRouterImage(
  text: string,
  images: NonNullable<ProviderImageRequest["referenceImages"]>,
  model: string,
  abortSignal?: AbortSignal,
  mimeTypes?: string[],
): Promise<string | undefined> {
  const response = await fetch(OPENROUTER_IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnvironmentVariable("OPENROUTER_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: text,
      aspect_ratio: "16:9",
      output_format: "jpeg",
      ...(images.length > 0
        ? {
          input_references: images.slice(0, 16).map((image, i) => ({
            type: "image_url",
            image_url: { url: openRouterReferenceDataUrl(image, mimeTypes?.[i] ?? (typeof image === "string" ? undefined : sniffImageMime(Buffer.from(image instanceof ArrayBuffer ? new Uint8Array(image) : image as Uint8Array)) ?? undefined)) },
          })),
        }
        : {}),
    }),
    ...(abortSignal ? { signal: abortSignal } : {}),
  });
  if (!response.ok) {
    const snippet = await response.text().then((t) => t.slice(0, 200)).catch(() => "");
    throw new Error(`OpenRouter image request failed (${response.status}): ${snippet}`);
  }
  const json = (await response.json()) as { data?: Array<{ b64_json?: unknown }> };
  const b64 = json?.data?.[0]?.b64_json;
  return typeof b64 === "string" ? b64.replace(/^data:image\/[^;]+;base64,/, "") : undefined;
}

export interface ProviderImageRequest {
  text: string;
  referenceImages?: Array<Buffer | Uint8Array | ArrayBuffer | string>;
  /** Per-image MIME types parallel to referenceImages (e.g. image/jpeg for previousBlock). */
  referenceMimeTypes?: string[];
  abortSignal?: AbortSignal;
}

function referenceImageBase64(image: NonNullable<ProviderImageRequest["referenceImages"]>[number]): string {
  if (typeof image === "string") return image.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  return Buffer.from(image instanceof ArrayBuffer ? new Uint8Array(image) : image).toString("base64");
}

/** Executes image generation through the selected provider. */
export async function generateProviderImage(request: ProviderImageRequest): Promise<string | undefined> {
  const { provider, model } = getAiConfiguration().image;
  const images = request.referenceImages ?? [];
  const mimes = request.referenceMimeTypes ?? [];

  if (provider === "google") {
    const response = await getGoogleGenAiImageClient().models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [
          { text: request.text },
          ...images.map((image, i) => ({
            inlineData: { mimeType: resolveReferenceMimeType(image, mimes[i]), data: referenceImageBase64(image) },
          })),
        ],
      }],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "16:9" },
        ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
      },
    });
    return response.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .find((part) => part.inlineData?.data)?.inlineData?.data;
  }

  if (provider === "openrouter") {
    return generateOpenRouterImage(request.text, images, model, request.abortSignal, mimes);
  }

  if (provider === "huggingface") {
    const mime = images[0] ? resolveReferenceMimeType(images[0], mimes[0]) : undefined;
    const image = await getHuggingFaceImageClient().imageTextToImage(
      {
        provider: "fal-ai",
        model,
        ...(images[0] ? { inputs: new Blob([images[0] as BlobPart], mime ? { type: mime } : undefined) } : {}),
        parameters: {
          prompt: request.text,
          target_size: { width: 1536, height: 864 },
        },
      },
      {
        retry_on_error: false,
        ...(request.abortSignal ? { signal: request.abortSignal } : {}),
      },
    );
    return Buffer.from(await image.arrayBuffer()).toString("base64");
  }

  const prompt = images.length > 0 ? { text: request.text, images } : request.text;
  const response = await generateImage({
    model: getImageModel(),
    prompt,
    n: 1,
    aspectRatio: "16:9",
    maxRetries: 0,
    ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
  });
  return response.image?.base64;
}

/** Returns an image model selected by AI_IMAGE_PROVIDER and AI_IMAGE_MODEL. */
export function getImageModel(): ImageModel {
  const provider = configuredProvider("image");
  if (provider === "opencode" || provider === "huggingface" || provider === "openrouter") {
    throw new Error(
      provider === "huggingface"
        ? "Hugging Face uses its direct inference client. Use generateStoryImage instead of getImageModel."
        : provider === "openrouter"
          ? "OpenRouter uses its direct Images API client. Use generateStoryImage instead of getImageModel."
          : "OpenCode does not expose an AI SDK image model. Set AI_IMAGE_PROVIDER to google, openai, huggingface, or openrouter.",
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
  if (provider === "opencode" || provider === "huggingface") {
    throw new Error(
      "OpenCode does not expose an AI SDK embedding model. Set AI_EMBEDDING_PROVIDER to google or openai.",
    );
  }

  const model = configuredModel("embedding", provider);

  switch (provider) {
    case "google":
      return googleProvider().embeddingModel(model);
    case "openai":
      return openaiProvider().embedding(model);
    case "openrouter":
      return openrouterProvider().embedding(model);
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

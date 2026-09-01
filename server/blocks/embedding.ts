import { embed } from "ai";
import { logAiCall, logAiCallComplete, logAiCallFailure } from "../ai-call-logger";
import { getAiConfiguration, getEmbeddingModel } from "./ai-provider";

const DEFAULT_EMBEDDING_DIMENSIONS = 768;

function embeddingDimensions(): number {
  const configured = Number.parseInt(
    process.env.AI_EMBEDDING_DIMENSIONS ?? `${DEFAULT_EMBEDDING_DIMENSIONS}`,
    10,
  );

  if (!Number.isInteger(configured) || configured <= 0) {
    throw new Error("AI_EMBEDDING_DIMENSIONS must be a positive integer.");
  }

  return configured;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const { provider, model } = getAiConfiguration().embedding;
    const dimensions = embeddingDimensions();
    const providerOptions =
      provider === "google"
        ? { google: { outputDimensionality: dimensions } }
        : { openai: { dimensions } };
    const aiCall = logAiCall({
      method: "embed",
      provider,
      model,
      parameters: { dimensions, providerOptions },
      input: text,
    });

    let response;
    try {
      response = await embed({
        model: getEmbeddingModel(),
        value: text,
        providerOptions:
          provider === "google"
            ? { google: { outputDimensionality: dimensions } }
            : { openai: { dimensions } },
      });
    } catch (error) {
      logAiCallFailure("embed", aiCall, error);
      throw error;
    }

    const embedding = response.embedding;
    if (!embedding || embedding.length === 0) {
      const error = new Error("No embedding values returned");
      logAiCallFailure("embed", aiCall, error);
      throw error;
    }

    logAiCallComplete("embed", aiCall, { embedding: "returned" });

    return embedding;
  } catch (err) {
    console.error("[Embedding] Failed to generate embedding:", err);
    throw err;
  }
}

export async function generateBlockEmbedding(blockContent: string, blockTitle?: string | null): Promise<number[]> {
  const fullText = blockTitle ? `${blockTitle}. ${blockContent}` : blockContent;
  return generateEmbedding(fullText);
}

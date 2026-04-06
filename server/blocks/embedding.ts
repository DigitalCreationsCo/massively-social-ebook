import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({});

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await ai.models.embedContent({
      model: "gemini-embedding-001",
      contents: [text],
      config: {
        outputDimensionality: 768,
      }
    });

    const embedding = response.embeddings?.[0]?.values;
    if (!embedding || embedding.length === 0) {
      throw new Error("No embedding values returned");
    }

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

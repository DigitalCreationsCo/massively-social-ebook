import { GoogleGenAI, Type, Schema } from "@google/genai";
import { createStoryBlockInstructions } from "../prompts/storyblock-instructions";
import { createImageInstructions } from "../prompts/image-instructions";
import { buildRAGContext } from "./rag";

export const ai = new GoogleGenAI({});

const lmParamsGoogle = {
  model: 'gemini-2.5-flash',
  imagenModel: 'imagen-4.0-generate-001',
};

export interface StoryBlockResult {
  title: string;
  content: string;
  optionA?: { label: string; description: string; };
  optionB?: { label: string; description: string; };
}

export async function generateStoryBlock(channelId: string, previousContext: string, isResolution: boolean = false): Promise<StoryBlockResult> {
  // Enrich context with RAG (transparently falls back to previousContext on error)
  const enrichedContext = await buildRAGContext(channelId, previousContext);

  const prompt = createStoryBlockInstructions({
    previous: previousContext,
    ragContext: enrichedContext !== previousContext ? enrichedContext : undefined,
    isResolution,
  });

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: "A short, engaging title for this block." },
      content: { type: Type.STRING, description: "The story content, max 3 sentences." },
      optionA: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING, description: "Short label for the first choice." },
          description: { type: Type.STRING, description: "Description of the first choice." }
        },
        required: [ "label", "description" ]
      },
      optionB: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING, description: "Short label for the second choice." },
          description: { type: Type.STRING, description: "Description of the second choice." }
        },
        required: [ "label", "description" ]
      }
    },
    required: [ "title", "content" ] // optionA and optionB are no longer strictly required at schema level for resolution
  };

  const response = await ai.models.generateContent({
    model: lmParamsGoogle.model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: responseSchema,
    }
  });

  if (!response.text) {
    throw new Error("Failed to generate story block: No text returned.");
  }

  const result = JSON.parse(response.text) as StoryBlockResult;

  // Ensure options are present if not resolution, or removed if resolution
  if (isResolution) {
    delete result.optionA;
    delete result.optionB;
  }

  return result;
}

export async function generateStoryImage(description: string): Promise<string> {
  const prompt = createImageInstructions({ description });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: prompt,
      config: {
        responseModalities: [ "image" ],
        candidateCount: 1,
        imageConfig: {
          aspectRatio: "16:9",
        }
      }
    });

    const base64Image = response.candidates?.[ 0 ]?.content?.parts?.[ 0 ]?.inlineData?.data;

    if (!base64Image) {
      throw new Error("No image data returned.");
    }

    // Return data URL directly (no filesystem write)
    return `data:image/jpeg;base64,${base64Image}`;
  } catch (err) {
    console.warn("Failed to generate image, using fallback:", err);
    return "/images/img_1771936309521_ieycq2.jpg";
  }
}

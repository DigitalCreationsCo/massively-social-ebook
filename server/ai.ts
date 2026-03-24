import { GoogleGenAI, Type, Schema } from "@google/genai";
import { createStoryBlockInstructions } from "../prompts/storyblock-instructions";
import { createImageInstructions } from "../prompts/image-instructions";
import { NarrativeEngine, configureNarrativeLab } from "narrative-engine";
import { RagProvider } from './rag';

export const ai = new GoogleGenAI({});

const lmParamsGoogle = {
  model: 'gemini-2.5-flash-lite',
  imageModel: 'gemini-2.5-flash-image',
};

const TIMEOUT_CONTEXT_MS = 3000;

const engine = new NarrativeEngine(new RagProvider());
configureNarrativeLab(engine);
if (process.env.NODE_ENV === "development" && !(global as any)[ "__NARRATIVE_LAB_STARTED__" ]) {
  import("packages/narrative-engine/src/lab").then(({ startLabServer }) => {
    startLabServer().catch(err => console.error("[Lab] Boot failed:", err));
    (global as any)[ "__NARRATIVE_LAB_STARTED__" ] = true;
  });
}

export interface StoryBlockResult {
  title: string;
  content: string;
  optionA?: { label: string; description: string; };
  optionB?: { label: string; description: string; };
}

async function generateContextWithTimeout(channelId: string, inputQuery: string): Promise<string> {
  const timeoutPromise = new Promise<string>((_, reject) => {
    setTimeout(() => reject(new Error("Context generation timeout (>3000ms)")), TIMEOUT_CONTEXT_MS);
  });
  return Promise.race([ engine.generateContext(channelId, inputQuery), timeoutPromise ]);
}

export async function generateStoryBlock(channelId: string, previousContext: string, isResolution: boolean = false): Promise<StoryBlockResult> {
  let enrichedContext = previousContext;

  try {
    enrichedContext = await generateContextWithTimeout(channelId, previousContext);
  } catch (err) {
    console.warn("[NLP] Circuit breaker triggered, falling back to immediate context:", err);
    enrichedContext = previousContext;
  }

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
      model: lmParamsGoogle.imageModel,
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

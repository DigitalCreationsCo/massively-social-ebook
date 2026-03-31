import fs from "fs/promises";
import path from "path";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { createStoryBlockInstructions } from "../prompts/storyblock-instructions";
import { createImageInstructions } from "../prompts/image-instructions";
import { buildRAGContext } from "./rag";
import { addNotableEvent } from "./state-manager";
import { storage } from "./storage";

export const ai = new GoogleGenAI({});

const lmParamsGoogle = {
  model: 'gemini-2.5-flash-lite',
  imageModel: 'gemini-2.5-flash-image',
};

export interface StoryBlockResult {
  title: string;
  content: string;
  optionA?: { label: string; description: string; };
  optionB?: { label: string; description: string; };
  newNotableEvent?: string;
}

export async function generateStoryBlock(
  channelId: string, 
  previousContext: string, 
  isResolving: boolean = false, 
  sessionId?: number
): Promise<StoryBlockResult> {
  const enrichedContext = await buildRAGContext(channelId, previousContext, sessionId);

  const prompt = createStoryBlockInstructions({
    previousBlock: previousContext,
    ragContext: enrichedContext !== previousContext ? enrichedContext : undefined,
    isResolving,
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
      },
      newNotableEvent: {
        type: Type.STRING,
        description: "A brief description of a notable event that occurred in this block. Only include for major plot points, discoveries, character changes, or significant story developments. Omit if nothing notable happened."
      }
    },
    required: [ "title", "content" ]
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

  if (isResolving) {
    delete result.optionA;
    delete result.optionB;
  }

  if (sessionId && result.newNotableEvent && result.newNotableEvent.trim()) {
    try {
      const blockCount = await storage.getBlockCount(channelId);
      const eventText = `Block ${blockCount}: ${result.newNotableEvent}`;
      await addNotableEvent(sessionId, channelId, eventText);
      console.debug(`[RAG] Added notable event for session ${sessionId}: "${eventText}"`);
    } catch (err) {
      console.warn(`[RAG] Failed to add notable event for session ${sessionId}:`, err);
    }
  }

  try {
    const dateStr = new Date().toISOString().split('T')[0];
    const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionStr = sessionId ? `${sessionId}` : 'unknown';
    const logDir = path.join(process.cwd(), 'logs', 'prompts', sessionStr, channelId, dateStr);
    await fs.mkdir(logDir, { recursive: true });

    const logFile = path.join(logDir, `prompt_${timestampStr}.json`);
    const logEntry = {
      timestamp: new Date().toISOString(),
      sessionId,
      channelId,
      isResolving,
      previousContext,
      enrichedContext: enrichedContext !== previousContext ? enrichedContext : undefined,
      prompt,
      response: result
    };
    await fs.writeFile(logFile, JSON.stringify(logEntry, null, 2) + '\n');
  } catch (err) {
    console.error('Failed to log storyblock prompt:', err);
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

    return `data:image/jpeg;base64,${base64Image}`;
  } catch (err) {
    console.warn("Failed to generate image, using fallback:", err);
    return "/images/img_1771936309521_ieycq2.jpg";
  }
}

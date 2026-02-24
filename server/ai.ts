import { GoogleGenAI, Type, Schema } from "@google/genai";
import fs from "node:fs/promises";
import path from "node:path";
import { generateBlockInstructions } from "../prompts/generate-block";
import { generateImage } from "../prompts/generate-image";

export const ai = new GoogleGenAI({});

const lmParamsGoogle = {
  model: 'gemini-2.5-flash',
  imagenModel: 'imagen-3.0-generate-002',
};

export interface StoryBlockResult {
  title: string;
  content: string;
  optionA: { label: string; description: string; };
  optionB: { label: string; description: string; };
}

export async function generateStoryBlock(channelId: string, previousContext: string): Promise<StoryBlockResult> {
  const prompt = generateBlockInstructions({ previous: previousContext });

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
    required: [ "title", "content", "optionA", "optionB" ]
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

  return JSON.parse(response.text) as StoryBlockResult;
}

export async function generateStoryImage(description: string): Promise<string> {
  const prompt = generateImage({ description });

  const response = await ai.models.generateImages({
    model: lmParamsGoogle.imagenModel,
    prompt: prompt,
    config: {
      numberOfImages: 1,
      aspectRatio: "16:9",
      outputMimeType: "image/jpeg",
    }
  });

  const base64Image = response.generatedImages?.[ 0 ]?.image?.imageBytes;

  if (!base64Image) {
    throw new Error("Failed to generate image: No image data returned.");
  }

  const filename = `img_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
  const filepath = path.join(process.cwd(), "public", "images", filename);

  // Ensure the directory exists
  await fs.mkdir(path.dirname(filepath), { recursive: true });

  // Write the base64 data to a file
  await fs.writeFile(filepath, Buffer.from(base64Image, 'base64'));

  // Return the web-accessible URL
  return `/images/${filename}`;
}

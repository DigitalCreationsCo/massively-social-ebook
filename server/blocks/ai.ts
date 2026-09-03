import fs from "fs/promises";
import path from "path";
import { generateImage, generateText, Output } from "ai";
import { z } from "zod";
import {
  createStoryBlockContextPrompt,
  createStoryBlockSystemInstructions,
} from "../../prompts/storyblock.prompt";
import { createImageInstructions } from "../../prompts/image.prompt";
import { NarrativeEngine } from "@portalshq/narrativeengine";
import { RagProvider } from "./rag";
import { PxProvider } from "./px";
import { logAiCall, logAiCallComplete, logAiCallFailure } from "../ai-call-logger";
import { getAiConfiguration, getImageModel, getLanguageModel } from "./ai-provider";

const TIMEOUT_CONTEXT_MS = 8000;

const engine = new NarrativeEngine({ 
  dataProvider: new RagProvider(),
  pxProvider: new PxProvider()
 });

// Start the narrative lab server in development without blocking app initialization.
// Uses process.nextTick to defer execution after the current import cycle completes.
// Guard with try-catch to prevent production issues if import fails.
// if (process.env.NODE_ENV === "development" && !(global as any)["__NARRATIVE_LAB_STARTED__"]) {
//   (global as any)["__NARRATIVE_LAB_STARTED__"] = "pending";

//   process.nextTick(async () => {
//     // Guard against double-initialization
//     if ((global as any)["__NARRATIVE_LAB_STARTED__"] !== "pending") return;

//     try {
//       const { startLabServer } = await import("narrative-engine-lab");
//       await startLabServer();
//       (global as any)["__NARRATIVE_LAB_STARTED__"] = true;
//       console.log("[Lab] NarrativeEngine Lab ready");
//     } catch (err) {
//       (global as any)["__NARRATIVE_LAB_STARTED__"] = false;
//       console.error("[Lab] Boot failed (non-fatal):", err);
//     }
//   });
// } else if (process.env.NODE_ENV === "production") {
//   // Mark as skipped in production to prevent any attempt to load lab
//   (global as any)["__NARRATIVE_LAB_STARTED__"] = "skipped";
// }

export interface StoryBlockResult {
  title: string;
  content: string;
  dialogue?: string;
  optionA?: { label: string; description: string; };
  optionB?: { label: string; description: string; };
  newNotableEvent?: string;
}

const storyBlockSchema = z.object({
  title: z.string().describe("A short, engaging title for this block."),
  content: z.string().describe("The story content, max 3 sentences."),
  dialogue: z.string().optional().describe("Any spoken dialogue in the story content."),
  optionA: z
    .object({
      label: z.string().describe("Short label for the first choice."),
      description: z.string().describe("Description of the first choice."),
    })
    .optional(),
  optionB: z
    .object({
      label: z.string().describe("Short label for the second choice."),
      description: z.string().describe("Description of the second choice."),
    })
    .optional(),
  isNotable: z
    .boolean()
    .describe(
      "Whether this block is notable. Only include for major plot points, discoveries, character changes, or significant story developments.",
    ),
});

async function generateContextWithTimeout(channelId: string, inputQuery: string): Promise<string> {
  const timeoutPromise = new Promise<string>((_, reject) => {
    setTimeout(() => reject(new Error("Context generation timeout (>3000ms)")), TIMEOUT_CONTEXT_MS);
  });
  const contextPromise = engine
    .buildContext({ channelId, inputQuery })
    .then((context) => context.prompt);
  return await Promise.race([contextPromise, timeoutPromise]);
}

export async function generateStoryBlock(channelId: string, previousContext: string, isResolving: boolean = false, sessionId?: number): Promise<StoryBlockResult> {

  // Enrich context with RAG (transparently falls back to previousContext on error)
  let enrichedContext = previousContext;

  try {
    enrichedContext = await generateContextWithTimeout(channelId, previousContext);
  } catch (err) {
    console.warn("[NLP] Circuit breaker triggered, falling back to immediate context:", err);
    enrichedContext = previousContext;
  }

  // const  = createNextNarrativeIncrementPrompt({ })
  const contextPrompt = createStoryBlockContextPrompt({
    previousBlock: previousContext,
    ragContext: enrichedContext !== previousContext ? enrichedContext : undefined,
  });
  const systemInstructions = createStoryBlockSystemInstructions({ isResolving });

  const { provider, model } = getAiConfiguration().text;
  const aiCall = logAiCall({
    method: "generateText",
    provider,
    model,
    parameters: {
      channelId,
      isResolving,
      instructions: "story_block system instructions",
      output: { format: "object", name: "story_block" },
    },
    instructions: systemInstructions,
    prompt: contextPrompt,
  });

  let response;
  try {
    response = await generateText({
      model: getLanguageModel(),
      instructions: systemInstructions,
      prompt: contextPrompt,
      output: Output.object({
        schema: storyBlockSchema,
        name: "story_block",
        description: "The next block in the interactive story.",
      }),
    });
    if (response.output) {
      logAiCallComplete("generateText", aiCall, {
        output: "structured",
        response: response.output,
      });
    }
  } catch (error) {
    logAiCallFailure("generateText", aiCall, error);
    throw error;
  }

  if (!response.output) {
    const error = new Error("Failed to generate story block: No structured output returned.");
    logAiCallFailure("generateText", aiCall, error);
    throw error;
  }

  const result: StoryBlockResult = response.output;

  if (isResolving) {
    delete result.optionA;
    delete result.optionB;
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
      systemInstructions,
      prompt: contextPrompt,
      response: result
    };
    await fs.writeFile(logFile, JSON.stringify(logEntry, null, 2) + '\n');
  } catch (err) {
    console.error('Failed to log storyblock prompt:', err);
  }

  return result;
}

/**
 * Generates an image via the configured AI SDK image provider and returns raw base64.
 *
 * IMPORTANT: This function returns ONLY the base64-encoded bytes, NOT a
 * `data:` URI.  It is the caller's responsibility (via image-uploader.ts)
 * to upload the bytes to object storage and store the resulting URL in the
 * database.  No base64 strings must ever be persisted in the application DB.
 *
 * On failure the function **throws** — the caller should handle fallback
 * (e.g., `getRandomImage()` or a static fallback URL).
 */
export async function generateStoryImage(description: string): Promise<string> {
  const prompt = createImageInstructions({ description });
  const { provider, model } = getAiConfiguration().image;
  const aiCall = logAiCall({
    method: "generateImage",
    provider,
    model,
    parameters: { n: 1, aspectRatio: "16:9" },
    prompt,
  });

  let response;
  try {
    response = await generateImage({
      model: getImageModel(),
      prompt,
      n: 1,
      aspectRatio: "16:9",
    });
    if (response.image?.base64) {
      logAiCallComplete("generateImage", aiCall, { image: "returned" });
    }
  } catch (error) {
    logAiCallFailure("generateImage", aiCall, error);
    throw error;
  }

  const base64Image = response.image?.base64;

  if (!base64Image) {
    const error = new Error("No image data returned from the configured AI provider.");
    logAiCallFailure("generateImage", aiCall, error);
    throw error;
  }

  return base64Image; // raw base64 — NO `data:` prefix
}

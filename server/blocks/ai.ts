import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { createStoryBlockInstructions } from "../../prompts/storyblock.prompt";
import { createImageInstructions } from "../../prompts/image.prompt";
import { NarrativeEngine, configureLabEngine } from "narrative-engine";
import { RagProvider } from './rag';

export const ai = new GoogleGenAI({});

const lmParamsGoogle = {
  model: 'gemini-2.5-flash-lite',
  imageModel: 'gemini-2.5-flash-image',
};

const TIMEOUT_CONTEXT_MS = 8000;

// ---------------------------------------------------------------------------
// Context cache — avoids calling engine.generateContext() more than once for
// the same (channelId, inputQuery) pair within a short window.
//
// Key insight: engine.generateContext() is deterministic for the same inputs
// (channelId + previousContext).  If AI story block generation fails after
// context was fetched, the next tick retry will reuse the cached result
// instead of hitting the engine (and its DB queries) again.
// ---------------------------------------------------------------------------

interface ContextCacheEntry {
  result: string;
  timestamp: number;
}

const contextCache = new Map<string, ContextCacheEntry>();
const CONTEXT_CACHE_TTL_MS = 60_000; // 60 seconds — well past any retry window

function getCachedContext(channelId: string, inputQuery: string): string | null {
  const key = `${channelId}::${inputQuery}`;
  const entry = contextCache.get(key);
  if (entry && Date.now() - entry.timestamp < CONTEXT_CACHE_TTL_MS) {
    return entry.result;
  }
  contextCache.delete(key);
  return null;
}

function setCachedContext(channelId: string, inputQuery: string, result: string): void {
  const key = `${channelId}::${inputQuery}`;
  contextCache.set(key, { result, timestamp: Date.now() });
}

/**
 * Clears the context cache — exposed for testing.
 */
export function clearContextCache(): void {
  contextCache.clear();
}

const engine = new NarrativeEngine(new RagProvider());
configureLabEngine(engine);

// Start the narrative lab server in development without blocking app initialization.
// Uses process.nextTick to defer execution after the current import cycle completes.
// Guard with try-catch to prevent production issues if import fails.
if (process.env.NODE_ENV === "development" && !(global as any)["__NARRATIVE_LAB_STARTED__"]) {
  (global as any)["__NARRATIVE_LAB_STARTED__"] = "pending";

  process.nextTick(async () => {
    // Guard against double-initialization
    if ((global as any)["__NARRATIVE_LAB_STARTED__"] !== "pending") return;

    try {
      const { startLabServer } = await import("narrative-engine-lab");
      await startLabServer();
      (global as any)["__NARRATIVE_LAB_STARTED__"] = true;
      console.log("[Lab] NarrativeEngine Lab ready");
    } catch (err) {
      (global as any)["__NARRATIVE_LAB_STARTED__"] = false;
      console.error("[Lab] Boot failed (non-fatal):", err);
    }
  });
} else if (process.env.NODE_ENV === "production") {
  // Mark as skipped in production to prevent any attempt to load lab
  (global as any)["__NARRATIVE_LAB_STARTED__"] = "skipped";
}

export interface StoryBlockResult {
  title: string;
  content: string;
  dialogue?: string;
  optionA?: { label: string; description: string; };
  optionB?: { label: string; description: string; };
  newNotableEvent?: string;
}

async function generateContextWithTimeout(channelId: string, inputQuery: string): Promise<string> {
  // Check cache — same inputs produce the same result within a short window.
  const cached = getCachedContext(channelId, inputQuery);
  if (cached !== null) return cached;

  const timeoutPromise = new Promise<string>((_, reject) => {
    setTimeout(() => reject(new Error("Context generation timeout (>3000ms)")), TIMEOUT_CONTEXT_MS);
  });
  const result = await Promise.race([engine.generateContext(channelId, inputQuery), timeoutPromise]);
  setCachedContext(channelId, inputQuery, result);
  return result;
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
      dialogue: { type: Type.STRING, description: "Any spoken dialogue in the story content." },
      optionA: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING, description: "Short label for the first choice." },
          description: { type: Type.STRING, description: "Description of the first choice." }
        },
        required: ["label", "description"]
      },
      optionB: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING, description: "Short label for the second choice." },
          description: { type: Type.STRING, description: "Description of the second choice." }
        },
        required: ["label", "description"]
      },
      isNotable: {
        type: Type.BOOLEAN,
        description: "Whether this block is notable. Only include for major plot points, discoveries, character changes, or significant story developments. Omit if nothing notable happened."
      }
    },
    required: ["title", "content", "isNotable"]
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

/**
 * Generates an image via Google Gemini and returns the raw base64 payload.
 *
 * IMPORTANT: This function returns ONLY the base64-encoded bytes, NOT a
 * `data:` URI.  It is the caller's responsibility (via image-uploader.ts)
 * to upload the bytes to object storage and store the resulting URL in the
 * database.  No base64 strings must ever be persisted in the application DB.
 *
 * On failure the function **throws** — the caller should handle fallback
 * (e.g., `getRandomImage()` or a static fallback URL).
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function generateStoryImage(description: string): Promise<string> {

  const blocksDir = __dirname;

  const baseInlineData = {
    // displayName: 'base image',
    data: await fs.readFile(path.join(blocksDir, 'base.png'), 'base64'),
    mimeType: "image/png"
  };
  const subject1InlineData = {
    // displayName: 'subject 1 image',
    data: await fs.readFile(path.join(blocksDir, 'subject1.png'), 'base64'),
    mimeType: "image/png"
  };
  const subject2InlineData = {
    // displayName: 'subject 2 image',
    data: await fs.readFile(path.join(blocksDir, 'subject2.png'), 'base64'),
    mimeType: "image/png"
  };
  const subject3InlineData = {
    // displayName: 'subject 3 image',
    data: await fs.readFile(path.join(blocksDir, 'subject3.png'), 'base64'),
    mimeType: "image/png"
  };

  const prompt = createImageInstructions({ description });

  const response = await ai.models.generateContent({
    model: lmParamsGoogle.imageModel,
    contents: [
      { inlineData: baseInlineData },
      { inlineData: subject1InlineData },
      { inlineData: subject2InlineData },
      { inlineData: subject3InlineData },
      prompt
    ],
    config: {
      responseModalities: ["image"],
      candidateCount: 1,
      imageConfig: {
        aspectRatio: "16:9",
      },
    },
  });

  const base64Image =
    response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

  if (!base64Image) {
    throw new Error("No image data returned from Gemini.");
  }

  return base64Image; // raw base64 — NO `data:` prefix
}

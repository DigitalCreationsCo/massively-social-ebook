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
import { PxProvider, characterRepresentationProperties } from "./px";
import { logAiCall, logAiCallComplete, logAiCallFailure } from "../ai-call-logger";
import { getAiConfiguration, getImageModel, getLanguageModel } from "./ai-provider";
import {
  getImageReferenceLimits,
  selectImageRepresentations,
  type SelectedImageRepresentation,
} from "./image-references";
import { logger } from "../logger";
import { getRequiredEntities, getRequiredEntityManifests } from "../channel-registry";
import { loadStoryGenerationConfig } from "../story-generation-config";

export type { SelectedImageRepresentation };

// Bounded context workflow: 12s cap, fallback to previousContext on timeout.
const TIMEOUT_CONTEXT_MS = 12_000;

const engine = new NarrativeEngine({
  dataProvider: new RagProvider(),
  pxProvider: new PxProvider({
    getRequiredEntities,
    getRequiredEntityManifests,
  }),
  config: {
    representationProperties: characterRepresentationProperties,
    // PX is complementary only: a NAP/MCP/LLM hiccup must degrade to a
    // warning, never nuke the RAG chronologicalBlocks/lore already gathered.
    pxErrorPolicy: "continue"
  }
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
  /** Full NarrativeEngine context (entities preserve nested representation maps). */
  narrativeContext?: unknown;
  /** Preference-selected references from nested entity representations. */
  imageRepresentations?: SelectedImageRepresentation[];
  /** Alias for `imageRepresentations` (spec wording: "selected imageRepresentations"). */
  selectedImageRepresentations?: SelectedImageRepresentation[];
}

export interface ContextWithReferences {
  prompt: string;
  narrativeContext: unknown;
  imageRepresentations: SelectedImageRepresentation[];
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

function getEngineSelectionConfig(): { representationProperties: readonly string[]; maxUniqueEntityRepresentations: number } {
  try {
    const maybeEngine = engine as unknown as {
      getLabConfig?: () => { representationProperties?: readonly string[]; maxUniqueEntityRepresentations?: number };
    };
    if (typeof maybeEngine.getLabConfig === "function") {
      const config = maybeEngine.getLabConfig();
      return {
        representationProperties: Array.isArray(config.representationProperties) ? config.representationProperties : [],
        maxUniqueEntityRepresentations:
          typeof config.maxUniqueEntityRepresentations === "number" ? config.maxUniqueEntityRepresentations : 5,
      };
    }
  } catch {
    // Fall through to defaults (keeps unit-test doubles without getLabConfig working).
  }
  return { representationProperties: [], maxUniqueEntityRepresentations: 5 };
}

export async function generateContextWithTimeout(channelId: string, inputQuery: string): Promise<ContextWithReferences> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Context generation timeout (>${TIMEOUT_CONTEXT_MS}ms)`)), TIMEOUT_CONTEXT_MS);
  });
  try {
    const contextPromise = engine
      .buildContext({ channelId, inputQuery })
      .then((context) => {
        // Select exclusively from nested entity representations. The deprecated
        // top-level `context.representations` list is never consulted.
        const entities = (context as { entities?: readonly unknown[] }).entities ?? [];
        const { representationProperties, maxUniqueEntityRepresentations } = getEngineSelectionConfig();
        const imageRepresentations = selectImageRepresentations(
          entities,
          representationProperties,
          maxUniqueEntityRepresentations,
        );
        logger.info("[NLP] context selected references", "blocks", {
          entities: entities.length,
          selected: imageRepresentations.length,
          pairs: imageRepresentations.map((r) => `${r.entityId}#${r.representationKey}`),
          hashes: imageRepresentations.map((r) => r.hash),
        });
        return {
          prompt: (context as { prompt: string }).prompt,
          narrativeContext: context,
          imageRepresentations,
        };
      });
    return await Promise.race([contextPromise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function generateStoryBlock(channelId: string, previousContext: string, isResolving: boolean = false, sessionId?: number): Promise<StoryBlockResult> {

  // Enrich context with RAG (transparently falls back to previousContext on error)
  let enrichedContext = previousContext;
  let narrativeContext: unknown | undefined;
  let imageRepresentations: SelectedImageRepresentation[] | undefined;
  // Diagnosability: persisted into the prompt log so a cold start that fell
  // back can be told apart from a healthy-but-empty enrichment.
  let contextFailure: ContextFailure | undefined;

  try {
    const resolved = await generateContextWithTimeout(channelId, previousContext);
    enrichedContext = resolved.prompt;
    narrativeContext = resolved.narrativeContext;
    imageRepresentations = resolved.imageRepresentations;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn("[NLP] Circuit breaker triggered, falling back to immediate context", "blocks", error, {
      channelId,
      sessionId,
    });
    contextFailure = {
      reason: "backend_error",
      name: error.name,
      message: error.message.slice(0, 500),
    };
    enrichedContext = previousContext;
    narrativeContext = undefined;
    imageRepresentations = undefined;
  }

  // const  = createNextNarrativeIncrementPrompt({ })
  return buildBlockFromContext(channelId, previousContext, enrichedContext, narrativeContext, imageRepresentations, isResolving, sessionId, contextFailure);
}

/**
 * Generate a bounded canonical chain from one RAG/PX retrieval snapshot.
 *
 * Text remains ordered because every draft becomes the next draft's immediate
 * context.  Media is intentionally not generated here: callers admit media
 * only for real canonical slots they have capacity to stage, so a text window
 * can never fill the prepared playback queue speculatively.
 */
export async function generateCanonicalStoryWindow(
  channelId: string,
  previousContext: string,
  blockCount: number,
  sessionId?: number,
): Promise<StoryBlockResult[]> {
  const count = Math.max(0, Math.min(5, Math.floor(blockCount)));
  if (count === 0) return [];
  let enrichedContext = previousContext;
  let narrativeContext: unknown | undefined;
  let imageRepresentations: SelectedImageRepresentation[] | undefined;
  let contextFailure: ContextFailure | undefined;
  try {
    const resolved = await generateContextWithTimeout(channelId, previousContext);
    enrichedContext = resolved.prompt;
    narrativeContext = resolved.narrativeContext;
    imageRepresentations = resolved.imageRepresentations;
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    logger.warn("[NLP] Canonical window context failed; using immediate context", "blocks", error, { channelId, sessionId });
    contextFailure = { reason: "backend_error", name: error.name, message: error.message.slice(0, 500) };
  }

  const generated: StoryBlockResult[] = [];
  let immediateContext = previousContext;
  for (let index = 0; index < count; index += 1) {
    // Preserve retrieved history while explicitly injecting the newest
    // generated continuation, which NarrativeEngine could not know when its
    // one context build began.
    const contextualPrompt = index === 0
      ? enrichedContext
      : `${enrichedContext}\n\nSequential continuation generated in this window:\n${immediateContext}`;
    const block = await buildBlockFromContext(
      channelId,
      immediateContext,
      contextualPrompt,
      narrativeContext,
      imageRepresentations,
      index === count - 1,
      sessionId,
      contextFailure,
    );
    generated.push(block);
    immediateContext = block.content;
  }
  return generated;
}

/** Why the prompt fell back to immediate context (persisted in the prompt log). */
export interface ContextFailure {
  reason: "backend_error";
  name?: string;
  message?: string;
}

async function buildBlockFromContext(
  channelId: string,
  previousContext: string,
  enrichedContext: string,
  narrativeContext: unknown | undefined,
  imageRepresentations: SelectedImageRepresentation[] | undefined,
  isResolving: boolean,
  sessionId?: number,
  contextFailure?: ContextFailure,
): Promise<StoryBlockResult> {
  const contextPrompt = createStoryBlockContextPrompt({
    previousBlock: previousContext,
    ragContext: enrichedContext !== previousContext ? enrichedContext : undefined,
  });
  const storyGeneration = loadStoryGenerationConfig();
  const systemInstructions = createStoryBlockSystemInstructions({
    isResolving,
    publicChoicesEnabled: storyGeneration.publicChoicesEnabled,
  });

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

  if (isResolving || !storyGeneration.publicChoicesEnabled) {
    delete result.optionA;
    delete result.optionB;
  }

  // Attach full context + selected references only on successful enrichment.
  // Timeout/PX failures return neither (fallback path above leaves both undefined).
  if (narrativeContext !== undefined && imageRepresentations !== undefined) {
    result.narrativeContext = narrativeContext;
    result.imageRepresentations = imageRepresentations;
    result.selectedImageRepresentations = imageRepresentations;
  }

  // Fire-and-forget: never block generation on prompt logging.
  void (async () => {
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
        publicChoices: {
          configured: storyGeneration.publicChoiceCount,
          effect: storyGeneration.publicChoiceEffect,
        },
        previousContext,
        enrichedContext: enrichedContext !== previousContext ? enrichedContext : undefined,
        // Present only when enrichment fell back: distinguishes a backend
        // failure from a healthy-but-empty enrichment.
        ...(contextFailure ? { contextFailure } : {}),
        systemInstructions,
        prompt: contextPrompt,
        response: result
      };
      await fs.writeFile(logFile, JSON.stringify(logEntry, null, 2) + '\n');
    } catch (err) {
      console.error('Failed to log storyblock prompt:', err);
    }
  })();

  return result;
}

export interface GenerateStoryImageOptions {
  /** Decoded reference image bytes (Buffer/Uint8Array/ArrayBuffer/base64). */
  referenceImages?: Array<Buffer | Uint8Array | ArrayBuffer | string>;
  /** Content hashes for observability (never log bytes). */
  referenceHashes?: string[];
  /** Original candidate count before provider-limit slicing (for logging). */
  candidateCount?: number;
  abortSignal?: AbortSignal;
}

/**
 * Generates an image via the configured AI SDK image provider and returns raw base64.
 *
 * IMPORTANT: This function returns ONLY the base64-encoded bytes, NOT a
 * `data:` URI.  It is the caller's responsibility (via image-uploader.ts)
 * to upload the bytes to object storage and store the resulting URL in the
 * database.  No base64 strings must ever be persisted in the application DB.
 *
 * Reference images are passed as decoded Buffers (never URLs or manually
 * produced base64) via `prompt: { text, images }`. When no usable reference
 * remains, the current text-only prompt is used.
 *
 * On failure the function **throws** — the caller should handle fallback
 * (e.g., `getRandomImage()` or a static fallback URL).
 */
export async function generateStoryImage(description: string, options: GenerateStoryImageOptions = {}): Promise<string> {
  const text = createImageInstructions({ description });
  const { provider, model } = getAiConfiguration().image;
  const limits = getImageReferenceLimits(provider, model);
  const candidates = options.referenceImages ?? [];
  const usable = candidates.slice(0, limits.maxImages);
  const prompt = usable.length > 0 ? { text, images: usable } : text;

  logger.info("[ImageGen] generating image", "blocks", {
    provider,
    model,
    candidates: options.candidateCount ?? candidates.length,
    references: usable.length,
    hashes: options.referenceHashes?.slice(0, limits.maxImages) ?? [],
  });

  const aiCall = logAiCall({
    method: "generateImage",
    provider,
    model,
    parameters: {
      n: 1,
      aspectRatio: "16:9",
      references: usable.length,
      candidates: options.candidateCount ?? candidates.length,
    },
    prompt: text,
  });

  let response;
  try {
    response = await generateImage({
      model: getImageModel(),
      prompt,
      n: 1,
      aspectRatio: "16:9",
      // Broadcast has an archived-image fallback. Do not spend its available
      // playout buffer waiting through SDK retries when a provider is rate
      // limited or out of quota.
      maxRetries: 0,
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    });
    if (response.image?.base64) {
      logAiCallComplete("generateImage", aiCall, { image: "returned", references: usable.length });
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

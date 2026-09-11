import fs from "fs/promises";
import path from "path";
import { generateText, Output } from "ai";
import { z } from "zod";
import {
  createStoryBlockContextPrompt,
  createStoryBlockSystemInstructions,
} from "../../prompts/storyblock.prompt";
import {
  createAmbientContextPrompt,
  createAmbientSystemInstructions,
} from "../../prompts/ambient.prompt";
import { composeEntitiesPrompt } from "../../prompts/entity-to-prose.prompt";
import { createImageInstructions } from "../../prompts/image.prompt";
import {
  NarrativeEngine,
  type GenerationProvider,
  type GenerationProviderRequest,
  type HybridCandidate,
  type NarrativeBlock,
  type NarrativeBlockInput,
  type NarrativeContext,
  type NarrativeLore,
  type PxEnrichment,
  type PxProviderRequest,
} from "@portalshq/narrativeengine";
import { RagProvider } from "./rag";
import { PxProvider, characterRepresentationProperties } from "./px";
import { logAiCall, logAiCallComplete, logAiCallFailure } from "../ai-call-logger";
import {
  getAiConfiguration,
  generateProviderImage,
  getHuggingFaceImageClient,
  getImageModel,
  getLanguageModel,
} from "./ai-provider";
import {
  getImageReferenceLimits,
  selectImageRepresentations,
  type SelectedImageRepresentation,
} from "./image-references";
import { logger } from "../logger";
import { getRequiredEntities, getRequiredEntityManifests } from "../channel-registry";
import { loadStoryGenerationConfig } from "../story-generation-config";

export type { SelectedImageRepresentation };

// Bounded context workflow: 15s cap, fallback to previousContext on timeout.
const TIMEOUT_CONTEXT_MS = 15_000;

interface SequentialWindowParameters {
  batchId: string;
  ordinal: number;
  count: number;
  previousContext: string;
  sessionId?: number;
  // Ambient b-roll extension — when present, window uses ambient prompts and
  // world-grounded context instead of canonical chain.
  previousAmbient?: string;
  genre?: string;
  ambient?: boolean;
}

/**
 * NarrativeEngine owns retrieval and batch orchestration here, but canonical
 * persistence must wait for the matching image/audio. These temporary drafts
 * therefore materialize only inside the engine result and are invalidated as
 * soon as the caller extracts the ordered window.
 *
 * Identical concurrent reads are promise-deduplicated. generateBlocksBatch
 * may ask for N contexts, but a sequential window still consumes one physical
 * RAG snapshot rather than 4*N database queries.
 */
class ContextOnlyRagProvider extends RagProvider {
  private readonly pendingReads = new Map<string, Promise<unknown>>();
  private draftIndex = 0;

  private dedupe<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.pendingReads.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const pending = operation();
    this.pendingReads.set(key, pending);
    void pending.finally(() => {
      if (this.pendingReads.get(key) === pending) this.pendingReads.delete(key);
    }).catch(() => undefined);
    return pending;
  }

  override getBlockCount(channelId: string): Promise<number> {
    return this.dedupe(`count:${channelId}`, () => super.getBlockCount(channelId));
  }

  override getLoreAtoms(channelId: string): Promise<NarrativeLore[]> {
    return this.dedupe(`lore:${channelId}`, () => super.getLoreAtoms(channelId));
  }

  override getHybridSearchCandidates(channelId: string, query: string, limit: number): Promise<HybridCandidate<NarrativeBlock>[]> {
    return this.dedupe(`hybrid:${channelId}:${limit}:${query}`, () => super.getHybridSearchCandidates(channelId, query, limit));
  }

  override getNotableEvents(channelId: string): Promise<NarrativeBlock[]> {
    return this.dedupe(`notable:${channelId}`, () => super.getNotableEvents(channelId));
  }

  override getBlocksByIndices(channelId: string, indices: readonly number[]): Promise<NarrativeBlock[]> {
    return this.dedupe(`indices:${channelId}:${indices.join(",")}`, () => super.getBlocksByIndices(channelId, indices));
  }

  override async insertBlock(channelId: string, draft: NarrativeBlockInput): Promise<NarrativeBlock> {
    const index = ++this.draftIndex;
    return {
      ...draft,
      id: `canonical-window-draft-${index}`,
      index,
      channelId,
      content: draft.content,
      happenedAt: typeof draft.happenedAt === "number" ? draft.happenedAt : Date.now(),
    };
  }
}

class DedupePxProvider extends PxProvider {
  private readonly pending = new Map<string, Promise<PxEnrichment>>();

  override enrichContext(request: PxProviderRequest<NarrativeBlock, NarrativeLore>): Promise<PxEnrichment> {
    const key = `${request.channelId}:${request.inputQuery}:${request.chronologicalBlocks.map((block) => block.id).join(",")}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const pending = super.enrichContext(request);
    this.pending.set(key, pending);
    void pending.finally(() => {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    }).catch(() => undefined);
    return pending;
  }
}

const generationProvider: GenerationProvider<NarrativeBlockInput, NarrativeBlock, NarrativeLore, SequentialWindowParameters> = {
  async generateBlock(request) {
    // Single ambient blocks never happen via engine today — route by flag.
    const isAmbient = Boolean((request.parameters as SequentialWindowParameters)?.ambient);
    const fn = isAmbient ? generateAmbientWindowDrafts : generateSequentialWindowDrafts;
    const [draft] = await fn([request as GenerationProviderRequest<NarrativeBlock, NarrativeLore, SequentialWindowParameters>]);
    if (!draft) throw new Error("Sequential window provider returned no draft.");
    return draft;
  },
  async generateBlocksBatch(requests) {
    const first = requests[0] as GenerationProviderRequest<NarrativeBlock, NarrativeLore, SequentialWindowParameters> | undefined;
    const isAmbient = Boolean(first?.parameters?.ambient);
    const fn = isAmbient ? generateAmbientWindowDrafts : generateSequentialWindowDrafts;
    return fn(requests as readonly GenerationProviderRequest<NarrativeBlock, NarrativeLore, SequentialWindowParameters>[]);
  },
};

const engine = new NarrativeEngine({
  dataProvider: new ContextOnlyRagProvider(),
  generationProvider,
  pxProvider: new DedupePxProvider({
    getRequiredEntities,
    getRequiredEntityManifests,
  }),
  config: {
    preferredEntityRepresentationProperties: characterRepresentationProperties,
    blockRetrieval: {
      maximumBlocks: 12,
      steps: [
        { takeNewestBlocks: 7 },
        { addNotableBlocksUntilThereAre: 5 },
      ],
    },
    // PX is complementary only: a PX/MCP/LLM hiccup must degrade to a
    // warning, never nuke the RAG chronologicalBlocks/lore already gathered.
    enrichmentFailureBehavior: "continue",
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

/**
 * Creates a prompt string from narrative context using entity-to-prose for entity formatting.
 * This function gives the application control over prompt creation instead of relying on
 * NarrativeEngine's built-in prompt generation.
 */
function createPromptFromNarrativeContext(
  narrativeContext: unknown,
  inputQuery: string
): string {
  const context = narrativeContext as {
    entities?: readonly unknown[];
    chronologicalBlocks?: readonly { content: string; index: number }[];
    loreAtoms?: readonly { content: string }[];
    metadata?: { totalBlockCount: number };
  };
  
  const sections: string[] = [];
  
  // Convert entities to prose using entity-to-prose
  const entities = context.entities ?? [];
  if (entities.length > 0) {
    try {
      const entitiesProse = composeEntitiesPrompt(entities as any[]);
      if (entitiesProse) {
        sections.push(entitiesProse);
      }
    } catch (error) {
      console.warn("Failed to convert entities to prose, using fallback:", error);
      // Fallback to simple JSON if entity-to-prose fails
      sections.push(`Entities:\n${JSON.stringify(entities)}`);
    }
  }
  
  // Format chronological blocks using storyblock patterns
  if (context.chronologicalBlocks && context.chronologicalBlocks.length > 0) {
    const oldestFirst = [...context.chronologicalBlocks].reverse();
    const totalBlockCount = context.metadata?.totalBlockCount ?? oldestFirst.length;
    const blockLines = oldestFirst.map((block) => {
      const offset = Math.max(1, totalBlockCount - block.index + 1);
      const unit = offset === 1 ? "beat" : "beats";
      return `${offset} ${unit} ago: ${block.content}`;
    });
    sections.push(`Historical context:\n${blockLines.join('\n')}`);
  }
  
  // Format lore atoms
  if (context.loreAtoms && context.loreAtoms.length > 0) {
    sections.push(`Essential facts of the story: ${context.loreAtoms.map((atom) => atom.content).join(" ")}`);
  }
  
  // Add the input query
  sections.push(inputQuery);
  
  return sections.join('\n\n');
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

function queuePromptLog(
  channelId: string,
  sessionId: number | undefined,
  entry: Record<string, unknown>,
  prefix = "prompt",
): void {
  void (async () => {
    try {
      const now = new Date();
      const dateStr = now.toISOString().split("T")[0];
      const timestampStr = now.toISOString().replace(/[:.]/g, "-");
      const sessionStr = sessionId ? `${sessionId}` : "unknown";
      const logDir = path.join(process.cwd(), "logs", "prompts", sessionStr, channelId, dateStr);
      await fs.mkdir(logDir, { recursive: true });
      await fs.writeFile(
        path.join(logDir, `${prefix}_${timestampStr}.json`),
        `${JSON.stringify({ timestamp: now.toISOString(), sessionId, channelId, ...entry }, null, 2)}\n`,
      );
    } catch (error) {
      logger.warn("Failed to persist prompt log", "blocks", error instanceof Error ? error : new Error(String(error)), {
        channelId,
        sessionId,
        prefix,
      });
    }
  })();
}

/** Shared helper — one validated ordered LLM call for a window (DRY). */
async function executeWindowGeneration(opts: {
  channelId: string;
  batchId: string | undefined;
  sessionId: number | undefined;
  count: number;
  systemInstructions: string;
  prompt: string;
  outputName: string;
  outputDescription: string;
  logPrefix: string;
  queueMeta: Record<string, unknown>;
}): Promise<z.infer<typeof storyBlockSchema>[]> {
  const { provider, model } = getAiConfiguration().text;
  const aiCall = logAiCall({
    method: "generateText",
    provider,
    model,
    parameters: {
      channelId: opts.channelId,
      batchId: opts.batchId,
      blockCount: opts.count,
      output: { format: "object", name: opts.outputName },
    },
    instructions: opts.systemInstructions,
    prompt: opts.prompt,
  });
  let response;
  try {
    response = await generateText({
      model: getLanguageModel(),
      instructions: opts.systemInstructions,
      prompt: opts.prompt,
      output: Output.object({
        schema: z.object({ blocks: z.array(storyBlockSchema).length(opts.count) }),
        name: opts.outputName,
        description: opts.outputDescription,
      }),
    });
    if (response.output) {
      logAiCallComplete("generateText", aiCall, {
        output: "structured_batch",
        blockCount: response.output.blocks.length,
      });
    }
  } catch (error) {
    logAiCallFailure("generateText", aiCall, error);
    throw error;
  }
  if (!response.output || response.output.blocks.length !== opts.count) {
    const error = new Error(`${opts.outputName} returned ${response.output?.blocks.length ?? 0} blocks; expected ${opts.count}.`);
    logAiCallFailure("generateText", aiCall, error);
    throw error;
  }
  queuePromptLog(opts.channelId, opts.sessionId, {
    batchId: opts.batchId,
    blockCount: opts.count,
    ...opts.queueMeta,
    systemInstructions: opts.systemInstructions,
    prompt: opts.prompt,
    response: response.output.blocks,
  }, opts.logPrefix as any);
  return response.output.blocks;
}

function entitiesProseFromContext(context: unknown): string {
  const entities = (context as { entities?: readonly unknown[] }).entities ?? [];
  if (entities.length === 0) return "";
  try {
    return composeEntitiesPrompt(entities as any[]) ?? "";
  } catch (error) {
    console.warn("Failed to convert entities to prose for batch generation:", error);
    return "";
  }
}

async function generateSequentialWindowDrafts(
  requests: readonly GenerationProviderRequest<NarrativeBlock, NarrativeLore, SequentialWindowParameters>[],
): Promise<readonly NarrativeBlockInput[]> {
  const first = requests[0];
  if (!first) return [];
  const count = requests.length;
  const parameters = first.parameters;
  const previousContext = parameters?.previousContext ?? first.context.inputQuery;
  const storyGeneration = loadStoryGenerationConfig();
  const systemInstructions = [
    createStoryBlockSystemInstructions({
      isResolving: false,
      publicChoicesEnabled: storyGeneration.publicChoicesEnabled,
    }),
    `Compose exactly ${count} chronological story sections in one response.`,
    "Block 1 continues the context. Each subsequent block must continue the previous block within this same response.",
    "Do not produce alternative candidates. Block order is canonical and must never be reordered.",
  ].join("\n\n");
  
  const entitiesProse = entitiesProseFromContext(first.context);
  const contextPrompt = createStoryBlockContextPrompt({
    previousBlock: previousContext,
    ragContext: entitiesProse || undefined,
  });
  const prompt = `${contextPrompt}\n\nReturn all ${count} blocks.`;
  const blocks = await executeWindowGeneration({
    channelId: first.context.channelId,
    batchId: parameters?.batchId,
    sessionId: parameters?.sessionId,
    count,
    systemInstructions,
    prompt,
    outputName: "sequential_story_window",
    outputDescription: "A strictly ordered window of consecutive canonical story blocks.",
    logPrefix: "batch_prompt",
    queueMeta: {
      previousContext,
      enrichedContext: (first.context as { prompt?: string }).prompt !== previousContext
        ? (first.context as { prompt?: string }).prompt
        : undefined,
    },
  });

  return blocks.map((block, ordinal) => {
    const draft: NarrativeBlockInput = {
      ...block,
      sessionId: parameters?.sessionId,
      windowOrdinal: ordinal,
      windowBatchId: parameters?.batchId,
      isNotable: block.isNotable,
    };
    if (!storyGeneration.publicChoicesEnabled) {
      delete draft.optionA;
      delete draft.optionB;
    }
    return draft;
  });
}

function buildAmbientWorldQuery(channelId: string, previousAmbientTail: string): string {
  // Sample world locations/characters from startup-cached PX manifests for variety.
  // Falls back to generic b-roll hint when no manifests yet (cold start/tests).
  const manifests = getRequiredEntityManifests(channelId) as Array<{
    id: string;
    name: string;
    entity_type: string;
    properties?: Record<string, unknown>;
  }>;
  if (!manifests || manifests.length === 0) {
    return previousAmbientTail
      ? `Ambient b-roll continuation — ${previousAmbientTail.slice(0,120)}`
      : "Ambient b-roll everyday moment in this world — familiar location, small everyday interaction";
  }
  const locations = manifests.filter((m) => {
    const t = (m.entity_type ?? "").toLowerCase();
    return t.includes("location") || t.includes("place") || t.includes("setting");
  });
  const characters = manifests.filter((m) => {
    const t = (m.entity_type ?? "").toLowerCase();
    return t.includes("character") || t.includes("person") || t.includes("people");
  });
  // Deterministically randomize per call for variety: sample up to 2 each.
  const sample = <T,>(arr: T[], n: number): T[] => {
    if (arr.length <= n) return arr;
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = tmp;
    }
    return copy.slice(0, n);
  };
  const locNames = sample(locations, 2).map((m) => m.name);
  const charNames = sample(characters, 2).map((m) => m.name);
  const parts: string[] = ["Ambient b-roll"];
  if (locNames.length) parts.push(`at ${locNames.join(" / ")}`);
  if (charNames.length) parts.push(`with ${charNames.join(", ")}`);
  parts.push("— everyday moment, slice-of-life");
  // Tail influences PX less; keep query world-grounded + short tail hint
  if (previousAmbientTail) parts.push(`— continuing: ${previousAmbientTail.slice(0, 100)}`);
  return parts.join(" ");
}

async function generateAmbientWindowDrafts(
  requests: readonly GenerationProviderRequest<NarrativeBlock, NarrativeLore, SequentialWindowParameters>[],
): Promise<readonly NarrativeBlockInput[]> {
  const first = requests[0];
  if (!first) return [];
  const count = requests.length;
  const parameters = first.parameters as SequentialWindowParameters;
  const previousAmbient = parameters?.previousAmbient ?? "";
  const genre = parameters?.genre ?? "mystery";
  const worldQuery = parameters?.previousContext ?? first.context.inputQuery;

  const systemInstructions = [
    createAmbientSystemInstructions({ genre: genre as any }),
    `Compose exactly ${count} chronological b-roll sections in one response.`,
    "Block 1 opens the current b-roll moment. Each subsequent block must continue the previous block within this same response as the next few minutes.",
    "Do not produce alternative candidates. Block order is b-roll order and must never be reordered.",
  ].join("\n\n");

  const entitiesProse = entitiesProseFromContext(first.context);
  const contextPrompt = createAmbientContextPrompt({
    worldProse: entitiesProse || undefined,
    previousAmbient: previousAmbient || undefined,
  });
  const prompt = `${contextPrompt}\n\nReturn all ${count} blocks.`;
  const blocks = await executeWindowGeneration({
    channelId: first.context.channelId,
    batchId: parameters?.batchId,
    sessionId: undefined,
    count,
    systemInstructions,
    prompt,
    outputName: "ambient_story_window",
    outputDescription: "A strictly ordered window of consecutive ambient b-roll blocks (non-canonical).",
    logPrefix: "ambient_batch_prompt",
    queueMeta: {
      previousAmbient,
      worldQuery,
      genre,
      enrichedWorld: (first.context as { prompt?: string }).prompt ?? undefined,
    },
  });

  return blocks.map((block, ordinal) => {
    const draft: NarrativeBlockInput = {
      ...block,
      windowOrdinal: ordinal,
      windowBatchId: parameters?.batchId,
      isNotable: false,
    };
    // Ambient never carries decisions
    delete (draft as any).optionA;
    delete (draft as any).optionB;
    return draft;
  });
}

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
      .then((narrativeContext) => {
        // Select exclusively from nested entity representations. The deprecated
        // top-level `context.representations` list is never consulted.
        const entities = (narrativeContext as { entities?: readonly unknown[] }).entities ?? [];
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
        
        // Create our own prompt instead of using engine's prompt
        let prompt: string;
        try {
          prompt = createPromptFromNarrativeContext(narrativeContext, inputQuery);
        } catch (error) {
          console.warn("Failed to create application prompt, falling back to engine prompt:", error);
          // Fallback to engine's prompt if our creation fails
          prompt = (narrativeContext as { prompt: string }).prompt;
        }
        
        return {
          prompt,
          narrativeContext,
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
 * Generate a bounded canonical chain through NarrativeEngine's batch API.
 *
 * The generation provider returns one validated ordered array so later items
 * are authored with earlier items in the same model response. Media is
 * intentionally not generated here: callers admit only the ordinary refill
 * deficit, so text cannot fill the prepared playback queue speculatively.
 */
export async function generateCanonicalStoryWindow(
  channelId: string,
  previousContext: string,
  blockCount: number,
  sessionId?: number,
): Promise<StoryBlockResult[]> {
  const configuredCount = Math.max(0, Math.min(5, Math.floor(blockCount)));
  // Until winner promotion exists, a public decision is a hard lookahead
  // boundary: never invent canonical descendants past an unresolved choice.
  const count = loadStoryGenerationConfig().publicChoicesEnabled
    ? Math.min(1, configuredCount)
    : configuredCount;
  if (count === 0) return [];
  const batchId = `${channelId}:${sessionId ?? "ambient"}:${Date.now()}`;
  try {
    const results = await engine.generateBlocksBatch(
      Array.from({ length: count }, (_, ordinal) => ({
        channelId,
        inputQuery: previousContext,
        parameters: {
          batchId,
          ordinal,
          count,
          previousContext,
          ...(sessionId !== undefined ? { sessionId } : {}),
        },
      })),
    );
    if (results.length !== count) {
      throw new Error(`NarrativeEngine returned ${results.length} canonical drafts; expected ${count}.`);
    }
    return results.map(({ block, context }) => {
      const { representationProperties, maxUniqueEntityRepresentations } = getEngineSelectionConfig();
      const imageRepresentations = selectImageRepresentations(
        context.entities ?? [],
        representationProperties,
        maxUniqueEntityRepresentations,
      );
      return {
        title: typeof block.title === "string" ? block.title : "Untitled",
        content: block.content,
        ...(typeof block.dialogue === "string" ? { dialogue: block.dialogue } : {}),
        ...(block.optionA ? { optionA: block.optionA as StoryBlockResult["optionA"] } : {}),
        ...(block.optionB ? { optionB: block.optionB as StoryBlockResult["optionB"] } : {}),
        narrativeContext: context,
        imageRepresentations,
        selectedImageRepresentations: imageRepresentations,
      };
    });
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    logger.warn("[NLP] NarrativeEngine canonical batch failed", "blocks", error, {
      channelId,
      sessionId,
      batchId,
      blockCount: count,
    });
    queuePromptLog(channelId, sessionId, {
      batchId,
      blockCount: count,
      previousContext,
      contextFailure: {
        reason: "backend_error",
        name: error.name,
        message: error.message.slice(0, 500),
      },
    }, "batch_failure");
    throw error;
  } finally {
    // generateBlocksBatch materializes context-only drafts in the engine's
    // cache. They are not canonical until media persistence succeeds.
    engine.invalidateChannel(channelId);
  }
}

/**
 * Ambient b-roll window — isolated from canonical continuity.
 * World-grounded via PX, ephemeral chaining via previousAmbient tail (2-block),
 * batched like canonical but never persisted (skip createBlock).
 * Cross-restart continuity is the caller's responsibility (systemSettings tail).
 */
export async function generateAmbientStoryWindow(
  channelId: string,
  previousAmbientTail: string,
  blockCount: number,
  genre: string = "mystery",
): Promise<StoryBlockResult[]> {
  const configuredCount = Math.max(0, Math.min(5, Math.floor(blockCount)));
  const count = configuredCount; // no decision-branch cap for ambient (never has options)
  if (count === 0) return [];
  const worldQuery = buildAmbientWorldQuery(channelId, previousAmbientTail);
  const batchId = `${channelId}:ambient:${Date.now()}`;
  try {
    const results = await engine.generateBlocksBatch(
      Array.from({ length: count }, (_, ordinal) => ({
        channelId,
        inputQuery: worldQuery,
        parameters: {
          batchId,
          ordinal,
          count,
          previousContext: worldQuery,
          previousAmbient: previousAmbientTail,
          genre,
          ambient: true,
        },
      })),
    );
    if (results.length !== count) {
      throw new Error(`NarrativeEngine returned ${results.length} ambient drafts; expected ${count}.`);
    }
    return results.map(({ block, context }) => {
      const { representationProperties, maxUniqueEntityRepresentations } = getEngineSelectionConfig();
      const imageRepresentations = selectImageRepresentations(
        (context as { entities?: unknown[] }).entities ?? [],
        representationProperties,
        maxUniqueEntityRepresentations,
      );
      return {
        title: typeof block.title === "string" ? block.title : "Untitled",
        content: block.content,
        ...(typeof block.dialogue === "string" ? { dialogue: block.dialogue } : {}),
        narrativeContext: context,
        imageRepresentations,
        selectedImageRepresentations: imageRepresentations,
      };
    });
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    logger.warn("[NLP] NarrativeEngine ambient batch failed", "blocks", error, {
      channelId,
      batchId,
      blockCount: count,
    });
    queuePromptLog(channelId, undefined, {
      batchId,
      blockCount: count,
      previousAmbient: previousAmbientTail,
      worldQuery,
      genre,
      contextFailure: {
        reason: "backend_error",
        name: error.name,
        message: error.message.slice(0, 500),
      },
    }, "ambient_batch_failure");
    throw error;
  } finally {
    engine.invalidateChannel(channelId);
  }
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

  let base64Image: string | undefined;
  try {
    base64Image = await generateProviderImage({
      text,
      ...(usable.length > 0 ? { referenceImages: usable } : {}),
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    });
    if (base64Image) {
      logAiCallComplete("generateImage", aiCall, { image: "returned", references: usable.length });
    }
  } catch (error) {
    logAiCallFailure("generateImage", aiCall, error);
    throw error;
  }

  if (!base64Image) {
    const error = new Error("No image data returned from the configured AI provider.");
    logAiCallFailure("generateImage", aiCall, error);
    throw error;
  }

  return base64Image; // raw base64 — NO `data:` prefix
}

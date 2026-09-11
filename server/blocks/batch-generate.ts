/**
 * Batch Block Generation — pre-generates all story blocks for a session.
 *
 * In the on-demand reading model, ALL blocks must be generated before the
 * episode goes live (no live voting/block generation during the session).
 *
 * This module:
 *   1. Reads the channel lore and previous session context for narrative continuity.
 *   2. Generates N blocks sequentially, threading the narrative context forward.
 *   3. Generates an image for each block and uploads to GCS.
 *   4. Persists all blocks to the database.
 *
 * Callers:
 *   - Production: `startSessionForChannelId()` in channel-tick.ts, called when a
 *     session transitions from "scheduled" → "active" (if blocks don't exist yet).
 *   - Dev/Admin: `server/scripts/generate-episode.ts` CLI script.
 */

import { storage } from "../storage";
import { generateStoryBlock } from "./ai";
import { archiveStoryImage, generateStoryImageAssetsBatch } from "../image-uploader";
import { logger } from "../logger";

// ── Constants ──────────────────────────────────────────────────────────────

/** Default number of blocks to generate per session (targeting ~8 min reading). */
export const DEFAULT_BLOCK_COUNT = 20;

// ── Batch Generation ───────────────────────────────────────────────────────

export interface BatchGenerateOptions {
  /** Number of blocks to generate (default: 20). */
  blockCount?: number;
  /**
   * If true, blocks are generated but NOT persisted (dry run).
   * Useful for testing the generation pipeline.
   */
  dryRun?: boolean;
  /**
   * Optional signal to cancel generation mid-way.
   */
  signal?: AbortSignal;
  useEmbedding?: boolean;
}

export interface BatchGenerateResult {
  sessionId: number;
  channelId: string;
  blocksGenerated: number;
  blocksFailed: number;
  errors: string[];
  totalDurationMs: number;
}

/**
 * Generates all story blocks for a session as a batch.
 *
 * The blocks are generated sequentially because each block's content depends
 * on the previous block's output for narrative continuity.
 *
 * @param channelId - The channel ID.
 * @param sessionId - The session ID.
 * @param previousContext - The narrative context from a prior session (or empty string for first episode).
 * @param options - Optional configuration.
 * @returns Result summary with counts and timing.
 */
export async function batchGenerateBlocks(
  channelId: string,
  sessionId: number,
  previousContext: string,
  options: BatchGenerateOptions = {},
): Promise<BatchGenerateResult> {
  const {
    blockCount = DEFAULT_BLOCK_COUNT,
    dryRun = false,
    signal,
  } = options;

  const result: BatchGenerateResult = {
    sessionId,
    channelId,
    blocksGenerated: 0,
    blocksFailed: 0,
    errors: [],
    totalDurationMs: 0,
  };

  const startTime = Date.now();

  logger.info(
    `[BatchGen] Starting generation of ${blockCount} blocks for session ${sessionId} (channel: ${channelId})`,
    "blocks",
    { dryRun, blockCount, sessionId, channelId },
  );

  let currentContext = previousContext;

  // Phase 1: sequential text — each block's content depends on the previous
  // block's output for narrative continuity, so this cannot be parallelized.
  const drafts: Array<{
    block: Awaited<ReturnType<typeof generateStoryBlock>>;
    imageDescription: string;
  }> = [];

  for (let i = 0; i < blockCount; i++) {
    // Check for cancellation
    if (signal?.aborted) {
      logger.warn(
        `[BatchGen] Generation cancelled at block ${i + 1}/${blockCount} for session ${sessionId}`,
        "blocks",
      );
      result.errors.push(`Cancelled at block ${i + 1}`);
      break;
    }

    const blockStartTime = Date.now();
    const blockNumber = i + 1;

    try {
      // The last block (i === blockCount - 1) is the resolution block
      const isLastBlock = i === blockCount - 1;
      const block = await generateStoryBlock(
        channelId,
        currentContext,
        isLastBlock,
        sessionId,
      );

      logger.debug(
        `[BatchGen] Block ${blockNumber}/${blockCount} generated: "${block.title}"`,
        "blocks",
        { sessionId, blockNumber, title: block.title },
      );

      drafts.push({
        block,
        imageDescription: `${block.title}: ${block.content.slice(0, 200)}`,
      });
      // Thread the narrative context forward immediately so a later image-batch
      // failure never breaks continuity.
      currentContext = block.content;
      result.blocksGenerated++;

      logger.debug(
        `[BatchGen] Block ${blockNumber}/${blockCount} completed in ${Date.now() - blockStartTime}ms`,
        "blocks",
        { sessionId, durationMs: Date.now() - blockStartTime },
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        `[BatchGen] Failed to generate block ${blockNumber}/${blockCount} for session ${sessionId}`,
        "blocks",
        err instanceof Error ? err : new Error(String(err)),
        { sessionId, blockNumber },
      );
      result.blocksFailed++;
      result.errors.push(`Block ${blockNumber}: ${errorMsg}`);

      // Continue to next block — a single failure shouldn't abort the entire batch
      // unless the error suggests a systemic issue
      if (err instanceof Error && err.message.includes("quota")) {
        logger.error("[BatchGen] Quota error — aborting batch generation", "blocks");
        break;
      }
    }
  }

  // Phase 2: batched images — 4-8 different prompts through the paced batch
  // lane (concurrency + start interval + shared 429 cooldown). Per-item
  // failures are non-fatal: the block persists with no image.
  const imageUrls: (string | null)[] = new Array(drafts.length).fill(null);
  if (!signal?.aborted && drafts.length > 0) {
    try {
      const assets = await generateStoryImageAssetsBatch(
        drafts.map((draft) => ({
          description: draft.imageDescription,
          imageRepresentations:
            draft.block.imageRepresentations ?? draft.block.selectedImageRepresentations ?? [],
        })),
        { ...(signal ? { signal } : {}) },
      );
      await Promise.all(assets.map(async (asset, index) => {
        if (!asset) return;
        try {
          imageUrls[index] = await archiveStoryImage(asset, channelId, "block");
        } catch (imgErr) {
          logger.warn(
            `[BatchGen] Image upload failed for block ${index + 1} (session ${sessionId}): ${imgErr instanceof Error ? imgErr.message : String(imgErr)}`,
            "blocks",
          );
        }
      }));
    } catch (imgErr) {
      logger.warn(
        `[BatchGen] Image batch failed for session ${sessionId} (continuing without images): ${imgErr instanceof Error ? imgErr.message : String(imgErr)}`,
        "blocks",
      );
    }
  }

  // Phase 3: persist (unless dry run)
  if (!dryRun) {
    for (let i = 0; i < drafts.length; i++) {
      if (signal?.aborted) {
        result.errors.push(`Cancelled before persisting block ${i + 1}`);
        break;
      }
      const draft = drafts[i]!;
      try {
        await storage.createBlock({
          channelId,
          sessionId,
          title: draft.block.title,
          content: draft.block.content,
          dialogue: draft.block.dialogue ?? null,
          imageUrl: imageUrls[i] ?? null,
          optionA: draft.block.optionA ?? null,
          optionB: draft.block.optionB ?? null,
          ttsEnabled: true,
          audioUrl: null,
          isNotable: false, // We don't set isNotable during batch gen; the replay system marks notable blocks separately
        },
        options.useEmbedding ?? false,
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(
          `[BatchGen] Failed to persist block ${i + 1}/${drafts.length} for session ${sessionId}`,
          "blocks",
          err instanceof Error ? err : new Error(String(err)),
          { sessionId, blockNumber: i + 1 },
        );
        result.blocksFailed++;
        result.blocksGenerated--;
        result.errors.push(`Block ${i + 1} persist: ${errorMsg}`);
      }
    }
  }

  result.totalDurationMs = Date.now() - startTime;

  logger.info(
    `[BatchGen] Finished generation for session ${sessionId}: ` +
      `${result.blocksGenerated} generated, ${result.blocksFailed} failed in ${result.totalDurationMs}ms`,
    "blocks",
    { sessionId, blocksGenerated: result.blocksGenerated, blocksFailed: result.blocksFailed, totalDurationMs: result.totalDurationMs },
  );

  return result;
}

/**
 * Gets the narrative context from the last block of the previous session.
 * Returns empty string if there's no prior session.
 */
export async function getPreviousSessionContext(
  channelId: string,
  sessionId: number,
): Promise<string> {
  try {
    // Find the most recent completed session before this one
    const allSessions = await storage.listSessions(channelId, "completed");
    const previousSession = allSessions
      .filter((s) => s.id < sessionId)
      .sort((a, b) => b.id - a.id)[0];

    if (!previousSession) {
      logger.info(
        `[BatchGen] No previous session found for channel ${channelId}, starting fresh`,
        "blocks",
      );
      return "";
    }

    const blocks = await storage.getBlocksBySessionOrdered(previousSession.id);
    if (blocks.length === 0) {
      return "";
    }

    // Return the content of the last block as narrative context
    const lastBlock = blocks[blocks.length - 1];
    return lastBlock.content ?? "";
  } catch (err) {
    logger.error(
      `[BatchGen] Failed to get previous session context for session ${sessionId}`,
      "blocks",
      err instanceof Error ? err : new Error(String(err)),
    );
    return ""; // Fall back to empty context on error
  }
}

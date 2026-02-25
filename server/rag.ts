/**
 * RAG Context Builder
 *
 * Orchestrates the retrieval-augmented generation pipeline:
 * 1. Counts total blocks for a channel
 * 2. If enough history, computes reciprocal sequence indices
 * 3. Retrieves historical blocks at those positions
 * 4. Assembles a structured "Story So Far" + "Current Situation" context string
 */
import { storage } from "./storage";
import {
  generateReciprocalSequence,
  sequenceToBlockIndices,
  RAG_DIVISIONS,
  RAG_MIN_BLOCKS,
} from "@shared/rag";

/**
 * Builds an enriched context string for story generation using RAG.
 *
 * If the channel has fewer than RAG_MIN_BLOCKS blocks, returns the
 * immediateContext unchanged (not enough history for meaningful RAG).
 *
 * Otherwise, retrieves strategically-spaced blocks from the story's
 * history and formats them as a "Story So Far" preamble, followed by
 * the immediate context as "Current Situation".
 *
 * @param channelId - The channel to retrieve history from.
 * @param immediateContext - The caller's existing context (e.g. last block + choice).
 * @returns The enriched context string.
 */
export async function buildRAGContext(
  channelId: string,
  immediateContext: string
): Promise<string> {
  try {
    const blockCount = await storage.getBlockCount(channelId);

    if (blockCount < RAG_MIN_BLOCKS) {
      console.debug(
        `[RAG] Channel "${channelId}" has ${blockCount} blocks (min: ${RAG_MIN_BLOCKS}), skipping RAG.`
      );
      return immediateContext;
    }

    // Generate the reciprocal sequence across total block count
    const rawSequence = generateReciprocalSequence(blockCount, RAG_DIVISIONS);
    const allIndices = sequenceToBlockIndices(rawSequence);

    // Exclude the latest block (it's already in immediateContext)
    const indices = allIndices.filter((idx) => idx < blockCount);

    if (indices.length === 0) {
      console.debug(`[RAG] No historical indices to fetch for channel "${channelId}".`);
      return immediateContext;
    }

    console.debug(
      `[RAG] Channel "${channelId}": fetching blocks at positions [${indices.join(", ")}] out of ${blockCount} total.`
    );

    const historicalBlocks = await storage.getBlocksBySequence(channelId, indices);

    if (historicalBlocks.length === 0) {
      console.debug(`[RAG] No blocks returned for channel "${channelId}".`);
      return immediateContext;
    }

    // Format the historical blocks as a numbered summary
    const storySoFar = historicalBlocks
      .map((block, i) => {
        const title = block.title ? `"${block.title}" — ` : "";
        return `${i + 1}. ${title}${block.content}`;
      })
      .join("\n");

    return `Story So Far (key moments from earlier):\n${storySoFar}\n\nCurrent Situation:\n${immediateContext}`;
  } catch (err) {
    console.error(`[RAG] Error building context for channel "${channelId}":`, err);
    // Graceful degradation: return the immediate context on any failure
    return immediateContext;
  }
}

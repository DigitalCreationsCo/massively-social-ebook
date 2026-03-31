/**
 * RAG Context Builder
 *
 * Orchestrates the retrieval-augmented generation pipeline using
 * the Stateful Chronicle Architecture:
 * 1. Counts total blocks for a channel
 * 2. Computes reciprocal sequence indices
 * 3. Expands to clustered indices (micro-context: [idx-1, idx, idx+1])
 * 4. Retrieves historical blocks at clustered positions
 * 5. Fetches story state (chronicle + summary)
 * 6. Assembles structured context with summary, chronicle, and micro-context
 */
import { storage } from "./storage";
import {
  generateReciprocalSequence,
  sequenceToBlockIndices,
  expandToClusteredIndices,
  RAG_DIVISIONS,
  RAG_MIN_BLOCKS,
} from "@shared/rag";
import { buildStoryContext, initializeStoryState } from "./state-manager";

/**
 * Builds an enriched context string for story generation using RAG.
 *
 * Uses the Stateful Chronicle Architecture:
 * - Summary: Compressed older events
 * - Chronicle: Notable events (bulleted list)
 * - Micro-Context: Clustered blocks from reciprocal sequence
 *
 * @param channelId - The channel to retrieve history from.
 * @param immediateContext - The caller's existing context (e.g. last block + choice).
 * @param sessionId - The session ID for story state management.
 * @returns The enriched context string.
 */
export async function buildRAGContext(
  channelId: string,
  immediateContext: string,
  sessionId?: number
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
    const milestoneIndices = sequenceToBlockIndices(rawSequence);

    // Expand to clustered indices (adds surrounding blocks for connective tissue)
    const clusteredIndices = expandToClusteredIndices(
      milestoneIndices,
      blockCount
    );

    // Exclude the latest block (it's already in immediateContext)
    const indices = clusteredIndices.filter((idx) => idx < blockCount);

    if (indices.length === 0) {
      console.debug(`[RAG] No historical indices to fetch for channel "${channelId}".`);
      return immediateContext;
    }

    console.debug(
      `[RAG] Channel "${channelId}": fetching clustered blocks at positions [${indices.join(", ")}] out of ${blockCount} total.`
    );

    const historicalBlocks = await storage.getBlocksBySequence(channelId, indices);

    if (historicalBlocks.length === 0) {
      console.debug(`[RAG] No blocks returned for channel "${channelId}".`);
      return immediateContext;
    }

    // Format the historical blocks as a numbered summary (micro-context)
    const microContext = historicalBlocks
      .map((block, i) => {
        const title = block.title ? `"${block.title}" — ` : "";
        return `${i + 1}. ${title}${block.content}`;
      })
      .join("\n");

    // Get story state (chronicle + summary) if sessionId is provided
    let storyContext = microContext;
    
    if (sessionId) {
      try {
        const { context } = await buildStoryContext(
          sessionId,
          channelId,
          microContext
        );
        storyContext = context;
      } catch (stateErr) {
        console.warn(`[RAG] Failed to get story state for session ${sessionId}, falling back to micro-context only:`, stateErr);
        storyContext = microContext;
      }
    }

    return storyContext;
  } catch (err) {
    console.error(`[RAG] Error building context for channel "${channelId}":`, err);
    // Graceful degradation: return the immediate context on any failure
    return immediateContext;
  }
}

/**
 * Initializes story state for a new session.
 * Call this when a new session starts.
 */
export async function initializeSessionStoryState(
  sessionId: number,
  channelId: string
) {
  return initializeStoryState(sessionId, channelId);
}

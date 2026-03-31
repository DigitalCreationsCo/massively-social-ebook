/**
 * RAG (Retrieval-Augmented Generation) utilities for storyblock context.
 *
 * Uses a reciprocal sequence to select blocks at decreasing density from
 * the story's history — dense near the end (recent blocks), sparse near
 * the beginning (early blocks). This gives the AI model a condensed
 * overview of the full narrative arc while keeping token count bounded.
 */

/** Number of historical blocks to retrieve for RAG context. */
export const RAG_DIVISIONS = 5;

/** Minimum block count before RAG kicks in. */
export const RAG_MIN_BLOCKS = 3;

/**
 * Calculates the harmonic constant H(n) = sum of 1/i for i = 1..n.
 * Used as the normalizing denominator for the reciprocal sequence.
 *
 * @param n - Number of terms in the harmonic series.
 * @returns The harmonic sum.
 */
export const calculateHarmonicConstant = (n: number): number => {
    if (n <= 0) return 0;
    let sum = 0;
    for (let i = 1; i <= n; i++) {
        sum += 1 / i;
    }
    return sum;
};

/**
 * Generates a sequence from 1 to targetN with reciprocal spacing.
 * The jumps between consecutive values decrease as 1/i, producing
 * indices that are sparse at the start and dense at the end.
 *
 * @param targetN - The final number in the sequence (total block count).
 * @param divisions - The number of steps to reach the target.
 * @returns Array of (divisions + 1) numbers from 1 to targetN.
 */
export const generateReciprocalSequence = (targetN: number, divisions: number): number[] => {
    if (targetN <= 1 || divisions <= 0) return [ 1 ];

    const k = calculateHarmonicConstant(divisions);
    const scale = (targetN - 1) / k;
    const sequence: number[] = [ 1 ];

    for (let i = 1; i <= divisions; i++) {
        const lastValue = sequence[ i - 1 ];
        const jump = scale / i;
        sequence.push(Number((lastValue + jump).toFixed(2)));
    }

    return sequence;
};

/**
 * Converts a reciprocal sequence into unique, rounded, 1-indexed block positions.
 * Deduplicates and sorts ascending.
 *
 * @param sequence - Raw reciprocal sequence values.
 * @returns Sorted, unique integer positions.
 */
export const sequenceToBlockIndices = (sequence: number[]): number[] => {
    const rounded = sequence.map(v => Math.max(1, Math.round(v)));
    const unique = Array.from(new Set(rounded));
    return unique.sort((a, b) => a - b);
};


/**
 * Window size for clustered block fetching.
 * Fetches [index - 1, index, index + 1] around each milestone
 * to provide connective tissue (setup, action, resolution).
 */
export const RAG_CLUSTER_WINDOW = 1;

/**
 * Expands block indices to include surrounding blocks for micro-context.
 * This provides narrative connective tissue around each selected milestone.
 *
 * @param indices - The selected milestone indices from reciprocal sequence.
 * @param totalBlocks - Total number of blocks in the story.
 * @param windowSize - Number of blocks to include before/after each index.
 * @returns Sorted, unique set of indices including windows.
 */
export const expandToClusteredIndices = (
  indices: number[],
  totalBlocks: number,
  windowSize: number = RAG_CLUSTER_WINDOW
): number[] => {
  const windowedIndices = new Set<number>();

  for (const idx of indices) {
    // Add blocks from (idx - windowSize) to (idx + windowSize), bounded by story range
    for (let offset = -windowSize; offset <= windowSize; offset++) {
      const targetIdx = idx + offset;
      // Ensure we stay within valid block range (1 to totalBlocks)
      if (targetIdx >= 1 && targetIdx <= totalBlocks) {
        windowedIndices.add(targetIdx);
      }
    }
  }

  // Return sorted array
  return Array.from(windowedIndices).sort((a, b) => a - b);
};

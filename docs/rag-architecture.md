# Story RAG Architecture Documentation

The Retrieval-Augmented Generation (RAG) implementation in this project provides an AI model with a condensed but comprehensive overview of a story's entire narrative arc. It intelligently manages token limits by sampling historical story blocks at a varying density: sparse at the beginning and dense towards the most recent events.

## 1. Core Algorithm: The Reciprocal Sequence

**Location:** `@shared/rag.ts`

To ensure the AI understands both the foundational backstory and the immediate preceding context, the system uses a **Harmonic/Reciprocal Sequence Algorithm** to select which historical blocks to retrieve. 

Instead of retrieving the last $N$ blocks (which loses early context) or evenly spacing blocks (which loses immediate context), the algorithm calculates jumps between indices that decrease sequentially:
* **Initial jumps are large** (capturing sparse, major early milestones).
* **Final jumps are small** (capturing dense, immediate recent events).

### Mathematical Components:
1. **Harmonic Constant:** $H(n) = \sum_{i=1}^{n} \frac{1}{i}$
2. **Scaling Factor:** Scales the sequence to fit perfectly between index `1` and the total block count (`targetN`).
3. **Sequence Generation:** Adds progressive jumps of size $\frac{\text{scale}}{i}$ to generate the exact indices.
4. **Sanitization:** Converts the mathematical sequence into unique, rounded, 1-indexed integers.

### Tuning Parameters
* `RAG_DIVISIONS = 5`: The number of historical samples to extract.
* `RAG_MIN_BLOCKS = 3`: The minimum threshold of story blocks required before RAG activates.

---

## 2. Pipeline Orchestration

**Location:** `@server/rag.ts`

The server-side implementation acts as the orchestrator, integrating the math from the shared library with the database storage layer.

### The `buildRAGContext` Flow:
1. **Threshold Check:** Queries the database for the channel's total block count. If it is less than `RAG_MIN_BLOCKS` (3), it skips RAG and returns the immediate context.
2. **Index Calculation:** Calls the reciprocal sequence generator to determine which block positions to fetch.
3. **Exclusion:** Filters out the index of the absolute latest block, as that is already provided in the prompt's `immediateContext`.
4. **Data Retrieval:** Fetches the specific historical blocks from the database via `storage.getBlocksBySequence`.
5. **Prompt Assembly:** Structures the final injected prompt into two sections:
   * **`Story So Far:`** A chronologically ordered, numbered summary of the retrieved historical blocks.
   * **`Current Situation:`** The most recent state / latest block passed in by the caller.

### Graceful Degradation
If any part of the database query or generation fails, the system catches the error and safely falls back to returning just the `immediateContext` to prevent the story generation from crashing.

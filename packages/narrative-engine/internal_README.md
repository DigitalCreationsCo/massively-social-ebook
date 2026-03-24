# NarrativeEngine: Internal Documentation

> Technical reference for the NarrativeEngine implementation. Intended for developers extending or maintaining the engine.

## Table of Contents

1. [Package Structure](#package-structure)
2. [Core API](#core-api)
3. [Provider Interface](#provider-interface)
4. [Waterfall Pipeline](#waterfall-pipeline)
5. [Scoring System](#scoring-system)
6. [Trace System](#trace-system)
7. [Lab Integration](#lab-integration)
8. [Edge Cases](#edge-cases)

---

## Package Structure

```
packages/narrative-engine/
├── bin/
│   └── cli.ts       # CLI entry point
├── src/
│   ├── index.ts                 # Public exports
│   ├── engine.ts                 # NarrativeEngine class
│   ├── trace.ts                 # TraceObject & logger
│   ├── lab.ts                # Shadow route registration
│   ├── provider.ts              # NarrativeProvider interface
│   └── engine.test.ts           # 22 unit tests
├── lab/                      # React debug UI
│   ├── src/App.tsx
│   └── vite.config.ts
├── package.json
└── tsconfig.json
```

### Public Exports (`index.ts`)

```typescript
export { NarrativeEngine } from "./engine";
export { configureNarrativeLab } from "./lab";
export type { NarrativeProvider, HybridCandidate } from "./provider";
export type { TraceObject } from "./trace";
```

---

## Core API

### NarrativeEngine Class

**File**: `packages/narrative-engine/src/engine.ts`

```typescript
export class NarrativeEngine {
  constructor(private provider: NarrativeProvider) {}

  async generateContext(
    channelId: string,
    inputQuery: string
  ): Promise<string> {
    // Returns enriched RAG context string
  }
}
```

**Parameters**:
- `channelId: string` — Channel identifier ('scifi' | 'mystery')
- `inputQuery: string` — Immediate context (previous block content)

**Returns**: Enriched context string with lore and historical blocks

**Throws**: Propagates provider errors after logging to trace

---

## Provider Interface

**File**: `packages/narrative-engine/src/provider.ts`

```typescript
export interface NarrativeProvider {
  getLoreAtoms(channelId: string): Promise<Lore[]>;
  getNotableEvents(channelId: string): Promise<Block[]>;
  getBlocksByIndices(channelId: string, indices: number[]): Promise<Block[]>;
  getHybridSearchCandidates(
    channelId: string,
    query: string,
    limit: number
  ): Promise<HybridCandidate[]>;
  getBlockCount(channelId: string): Promise<number>;
}
```

### HybridCandidate Type

```typescript
export interface HybridCandidate extends Block {
  scoreVectorDense: number;    // Vector embedding similarity score
  scoreKeywordSparse: number;  // Full-text search rank score
}
```

### Implementation Requirements

The provider must return:
- **Lore**: All active lore atoms for the channel
- **Notable Events**: Blocks marked `isNotable = true`
- **Blocks by Indices**: Historical blocks at 1-indexed positions
- **Hybrid Candidates**: Blocks with vector and keyword scores, filtered by query

---

## Waterfall Pipeline

### Phase 1: Harvest

**Lines**: 39-63

```typescript
// 1a. Lore retrieval
const loreAtoms = await this.provider.getLoreAtoms(channelId);

// 1b. Reciprocal sequence calculation
const rawSequence = generateReciprocalSequence(blockCount, RAG_DIVISIONS);
const indicesHistorical = allIndices.filter((idx) => idx < blockCount);

// 1c. Historical block retrieval
const blocksReciprocal = await this.provider.getBlocksByIndices(
  channelId,
  indicesHistorical
);

// 1d. Hybrid search
const candidatesHybrid = await this.provider.getHybridSearchCandidates(
  channelId,
  inputQuery,
  20
);
```

**Reciprocal Sequence Algorithm** (`shared/rag.ts`):

The sequence produces indices with decreasing jump sizes:

```
targetN = 50, divisions = 5:
  Indices: [1, 21, 31, 38, 43, 50]
            ↑                     ↑
     sparse (beginning)     dense (recent)
```

### Phase 2: Fusion

**Lines**: 66-72

```typescript
const scoredCandidates = candidatesHybrid.map((candidate) => {
  const scoreRawFused =
    candidate.scoreVectorDense * WEIGHT_VECTOR_DENSE +
    candidate.scoreKeywordSparse * WEIGHT_KEYWORD_SPARSE;
  const scoreFinalFused = candidate.isNotable
    ? scoreRawFused * significanceCoefficient
    : scoreRawFused;
  return { ...candidate, scoreFinalFused };
});
```

### Phase 3: Anchor Boost

Applied inline with Fusion (line 70).

### Phase 4: Saliency Gate

**Lines**: 79-110

```typescript
// Threshold filter
const survivors: (HybridCandidate & { scoreFinalFused: number })[] = [];
const discarded: any[] = [];

for (const candidate of scoredCandidates) {
  if (candidate.scoreFinalFused >= saliencyGateThreshold) {
    survivors.push(candidate);
  } else {
    discarded.push({
      id: candidate.id,
      scoreFinalFused: candidate.scoreFinalFused,
      reason: "Below saliencyGateThreshold",
    });
  }
}

// Sort by score descending
survivors.sort((a, b) => b.scoreFinalFused - a.scoreFinalFused);

// Rank cap
const topSurvivors = survivors.slice(0, LIMIT_HYBRID_TOP);
const overflowDiscarded = survivors.slice(LIMIT_HYBRID_TOP).map(c => ({
  id: c.id,
  scoreFinalFused: c.scoreFinalFused,
  reason: "Exceeded LIMIT_HYBRID_TOP",
}));
```

### Phase 5: Temporal Alignment

**Lines**: 113-117

```typescript
private mergeAndSortChronologically(
  blocksHistorical: Block[],
  candidatesSurvivor: HybridCandidate[]
): Block[] {
  const merged = new Map<number, Block>();
  for (const block of blocksHistorical) {
    merged.set(block.id, block);
  }
  for (const candidate of candidatesSurvivor) {
    if (!merged.has(candidate.id)) {
      merged.set(candidate.id, candidate);
    }
  }
  return Array.from(merged.values()).sort((a, b) => a.id - b.id);
}
```

**Key behavior**: 
- Uses `id` as deduplication key
- Maintains chronological order (ascending by block ID)

### Phase 6: Natural Prose

**Lines**: 120-173

```typescript
private composeProse(
  blocksChrono: Block[],
  loreAtoms: Lore[],
  immediateContext: string,
  currentBlockCount: number
): string {
  const loreSection = loreAtoms.length > 0
    ? loreAtoms.map((l) => l.content).join(" ")
    : "";

  const blockSections = blocksChrono.map((block) => {
    const offsetHistorical = currentBlockCount - block.id;
    return `${offsetHistorical} storyblocks ago, ${block.content}`;
  });

  const parts: string[] = [];
  if (loreSection) {
    parts.push(`To maintain consistency with the established story: ${loreSection}`);
  }
  if (blockSections.length > 0) {
    parts.push(blockSections.join(". "));
  }
  parts.push(immediateContext);

  return parts.join(". ");
}
```

**Output format**:
```
To maintain consistency with the established story: [lore content]. [N] storyblocks ago, [content]. [Immediate context].
```

---

## Scoring System

### Constants

**File**: `packages/narrative-engine/src/engine.ts` (lines 6-12)

```typescript
const RAG_DIVISIONS = 5;           // Divisions in reciprocal sequence
const RAG_MIN_BLOCKS = 3;          // Minimum blocks before RAG activates
const WEIGHT_VECTOR_DENSE = 0.7;     // Vector similarity weight
const WEIGHT_KEYWORD_SPARSE = 0.3;  // Keyword matching weight
const significanceCoefficient = 1.5; // Notable block multiplier
const saliencyGateThreshold = 0.65;  // Minimum survival threshold
const LIMIT_HYBRID_TOP = 3;         // Maximum survivors after gate
```

### Formula

```
scoreFinalFused = (
  (vectorScore × 0.7) +
  (keywordScore × 0.3)
) × (isNotable ? 1.5 : 1.0)
```

### Score Components

| Component | Range | Source |
|-----------|-------|--------|
| `scoreVectorDense` | 0.0 - 1.0 | Vector embedding similarity (from provider) |
| `scoreKeywordSparse` | 0.0 - 1.0 | Normalized ts_rank from PostgreSQL |

**Note**: The current provider implementation (`server/storage.ts`) hardcodes `scoreVectorDense` to 0.85. Actual cosine similarity computation is not yet implemented.

---

## Trace System

### TraceObject Interface

**File**: `packages/narrative-engine/src/trace.ts`

```typescript
export interface TraceObject {
  timestamp: string;
  channelId: string;
  inputQuery: string;
  phases: {
    harvest?: {
      loreAtoms: string[];
      reciprocalIndices: number[];
      reciprocalBlocks: { id: number; content: string; isNotable: boolean }[];
      hybridCandidatesCount: number;
      hybridCandidatesRaw: {
        id: number;
        content: string;
        scoreVectorDense: number;
        scoreKeywordSparse: number;
        isNotable: boolean;
      }[];
    };
    fusion?: {
      scoredCandidates: {
        id: number;
        scoreFinalFused: number;
        isNotable: boolean;
      }[];
    };
    saliency?: {
      survivors: {
        id: number;
        scoreFinalFused: number;
      }[];
    };
    timeline?: {
      mergedBlocks: { id: number; content: string }[];
    };
    prose?: {
      finalContext: string;
    };
  };
  finalizedPrompt?: string;
  discardedCandidates: {
    id: number;
    scoreFinalFused: number;
    reason: string;
  }[];
  error?: string;
}
```

### Trace Logging

```typescript
export function loggerNarrativeTrace(traceObject: TraceObject): void {
  if (process.env.NODE_ENV !== "development") {
    return;  // Silent return in production
  }
  // Appends JSONL to .traces/narrative_ledger.jsonl
}
```

**File location**: `{cwd}/.traces/narrative_ledger.jsonl`

**Format**: One JSON object per line (JSONL)

**Behavior**:
- Development mode only (no production overhead)
- Append-only (no read/modify/write)
- Soft-fail on errors (warns but doesn't throw)

---

## Lab Integration

**File**: `packages/narrative-engine/src/lab.ts`

```typescript
export function configureNarrativeLab(engine: NarrativeEngine): void {
  // GET /__narrative_lab/traces
  // Returns all traces from .traces/narrative_ledger.jsonl
  
  // POST /__narrative_lab/generate
  // Stub endpoint for triggering test generations
}
```

### Lab UI Components

**File**: `packages/narrative-engine/lab/src/App.tsx`

| Component | Lines | Purpose |
|-----------|-------|---------|
| Diff Dashboard | 169-197 | Side-by-side input vs. finalized prompt |
| Lore Highlighter | 78-89 | Highlights lore atoms in context |
| Trace Inspector | 200-280 | 5-column phase metrics grid |
| Parameter Lab | 292-369 | Slider controls for constants |

### Parameter Lab Controls

```typescript
const [saliencyThreshold, setSaliencyThreshold] = useState(0.65);
const [weightDense, setWeightDense] = useState(0.7);
const [significanceCoef, setSignificanceCoef] = useState(1.5);
const [temporalPhrasing, setTemporalPhrasing] = useState(true);
```

**Status**: Controls exist but are not wired to the engine constants.

---

## Edge Cases

### Minimum Block Threshold

**File**: `packages/narrative-engine/src/engine.ts` (lines 29-31)

```typescript
if (blockCount < RAG_MIN_BLOCKS) {
  return inputQuery;
}
```

If fewer than 3 blocks exist, RAG is skipped entirely.

### Empty Results

**Hybrid search returns empty**:
- Proceeds to fusion with empty candidates array
- No survivors pass gate
- Final context = lore + immediate context (no historical blocks)

**Reciprocal sequence returns empty**:
- Merged timeline = only hybrid survivors
- Prose composition continues normally

### Error Handling

**Provider errors**:
```typescript
catch (err) {
  trace.error = err instanceof Error ? err.message : String(err);
  loggerNarrativeTrace(trace);
  throw err;  // Propagates to caller
}
```

**Trace write errors**:
```typescript
catch (err) {
  console.warn("[Trace] Failed to write trace file:", err);
  // Silent fail - doesn't affect pipeline
}
```

### Deduplication Logic

In `mergeAndSortChronologically`:
- Reciprocal blocks added first
- Hybrid survivors added only if not already present
- Result sorted by `id` ascending

**Example**: If block 5 appears in both sources, only one instance is kept.

---

## Database Implementation Notes

### Provider Implementation

**File**: `server/storage.ts`

The `DatabaseStorage` class implements `NarrativeProvider`:

```typescript
async getHybridSearchCandidates(
  channelId: string,
  query: string,
  limit: number
): Promise<HybridCandidate[]> {
  // Uses PostgreSQL full-text search
  // ts_rank for keyword scoring
  // NOTE: vector score hardcoded to 0.85
}
```

### Vector Embeddings

The `blocks` table includes a `vector(768)` column for semantic embeddings:

```typescript
embedding: vector("embedding", { dimensions: 768 })
```

**Current status**: Embeddings are stored but not actively computed or used for similarity search.

### Soft-Delete Pattern

Lore deactivation uses soft-delete:

```typescript
async deactivateLore(id: number): Promise<Lore> {
  const [updatedLore] = await db
    .update(lore)
    .set({ isActive: false })
    .where(eq(lore.id, id))
    .returning();
  return updatedLore;
}
```

**Zero-Deletion Policy**: Lore is never hard-deleted, only deactivated.

---

## Testing

### Engine Tests

**File**: `packages/narrative-engine/src/engine.test.ts`

**Coverage**: 22 tests

| Test Category | Count | Coverage |
|---------------|-------|----------|
| Saliency gate | 2 | Threshold filtering, rank cap |
| Notable coefficient | 3 | 1.5x boost, score comparison |
| Chronological sorting | 2 | Ascending order, deduplication |
| Circuit breaker | 4 | Provider errors, timeout |
| Prose composition | 4 | Format, offset calculation |
| Fused relevance | 2 | Weight calculation, priority |

### Run Tests

```bash
npm test -- packages/narrative-engine/src/engine.test.ts
```

---

## Appendix: File Reference

| File | Lines | Purpose |
|------|-------|---------|
| `engine.ts` | 174 | Core waterfall implementation |
| `trace.ts` | 38 | Trace object and logger |
| `lab.ts` | 29 | Shadow route registration |
| `provider.ts` | 16 | Provider interface |
| `index.ts` | 7 | Public exports |
| `engine.test.ts` | 600+ | Unit tests |

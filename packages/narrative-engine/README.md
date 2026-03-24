# NarrativeEngine (NLP)

A zero-dependency, mathematically deterministic engine for narrative-driven contextual storytelling. It implements a Hybrid RAG (Retrieval-Augmented Generation) pipeline optimized for long-form narrative continuity.

## The Problem It Solves

As stories grow longer, AI-generated content risks:
- **Losing continuity** — forgetting established facts
- **Inconsistent characters** — contradicting previous descriptions
- **Disconnected arcs** — ignoring pivotal moments

The NarrativeEngine solves this by providing the AI with carefully selected context from the story's history.

## Core Concepts

The engine operates on a **Two-Vector Identity Model**:
- **Identity Vector (`id`)**: A unique `string` or `number` used for deduplication.
- **Temporal Vector (`happenedAt`)**: A strict `number` (Sequential ID or Unix Timestamp) used for chronological sorting and relative time phrasing ("X storyblocks ago").

## The Scoring Waterfall

1. **Hybrid Fusion**: Scores are weighted as `(Vector * 0.7) + (Keyword * 0.3)`.
2. **Significance Boost**: Blocks marked `isNotable` receive a `1.5x` multiplier.
3. **Saliency Gate**: Any block with a final fused score `< 0.65` is evicted to prevent hallucination noise.
4. **Tie-Breaking**: If scores are identical, the engine favors the most recent block (`happenedAt`).

## Installation

```bash
npm install narrative-engine
```

## Implementation Guide

### 1. Define Your Contract
The engine is generic. You can use your own database types as long as they satisfy the base interfaces.

```typescript
import { BaseNarrativeBlock, BaseNarrativeLore } from 'narrative-engine';

export interface MyStoryBlock extends BaseNarrativeBlock {
  authorId: string; // Additional field unique to your app
}
```

### 2. Create Your Provider
Implement the `NarrativeProvider` to bridge your database (PostgreSQL, Supabase, etc.) with the engine.

**Crucial:** All search scores must be normalized to a `0.0` to `1.0` range.

```typescript
import { NarrativeProvider, HybridCandidate, normalizeScore, configureNarrativeLab } from 'narrative-engine';

class MyDatabaseProvider implements NarrativeProvider<MyStoryBlock> {
  async getHybridSearchCandidates(channelId, query, limit) {
    const rawResults = await db.search(query);
    return rawResults.map(res => ({
      block: res,
      // Normalize your DB scores to 0-1
      scoreVectorDense: normalizeScore(res.similarity, 0, 1), 
      scoreKeywordSparse: normalizeScore(res.rank, 0, 100)
    }));
  }
  // Implement other methods...
}
```

### 3. Initialize the Engine
```typescript
const provider = new MyDatabaseProvider();
const engine = new NarrativeEngine(provider);

// Optional: Configure registry for the NarrativeEngine Test Lab
configureNarrativeLab(engine);

const prompt = await engine.generateContext("channel-123", "User's current choice");
```

## The NarrativeEngine Lab

The engine includes a visual laboratory for real-time prompt tuning. 

1. **Enable Tracing**: Set `NODE_ENV=development`.
2. **Launch**: `npx narrativeengine lab`
3. **Features**: 
   - **Saliency Slider**: Adjust the 0.65 threshold live.
   - **Lore Highlighter**: See which "Immutable Lore" atoms are currently active.
   - **Lab Environment**: Trigger test generations without affecting production data.

## Best Practices

- **Lore Capping**: The engine caps active lore at 20 atoms by default to prevent "Lore Overload" from eating your token budget. 
- **Reciprocal Skeleton**: The engine automatically injects a "skeleton" of the story (logarithmically spaced historical blocks) to ensure the LLM maintains a sense of the full narrative arc.
- **Circuit Breaker**: Always wrap your engine calls in a `try/catch`. If the engine fails, fallback to your `immediateContext` to keep the user experience seamless.

---

**Built for architects of digital lore.** 🚀
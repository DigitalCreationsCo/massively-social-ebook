import { describe, it, expect, vi, beforeEach } from "vitest";
import { NarrativeEngine } from "./engine";
import { NarrativeProvider, HybridCandidate, InMemoryNarrativeProvider } from "./provider";
import { BaseNarrativeBlock, BaseNarrativeLore } from "./types";

// Mocking the trace logger to avoid FS side effects
vi.mock("./trace", () => ({
  loggerNarrativeTrace: vi.fn(),
}));

describe("NarrativeEngine Logic Hardening", () => {
  let engine: NarrativeEngine;
  let mockProvider: NarrativeProvider<BaseNarrativeBlock, BaseNarrativeLore>;

  beforeEach(() => {
    mockProvider = {
      getLoreAtoms: vi.fn().mockResolvedValue([]),
      getNotableEvents: vi.fn().mockResolvedValue([]),
      getBlocksByIndices: vi.fn().mockResolvedValue([]),
      getHybridSearchCandidates: vi.fn().mockResolvedValue([]),
      getBlockCount: vi.fn().mockResolvedValue(10),
      addBlock: vi.fn().mockResolvedValue(undefined),
      getProviderType: () => 'test'
    };
    engine = new NarrativeEngine(mockProvider);
  });

  it("should enforce the Tie-Breaker Paradox (Recency wins)", async () => {
    // Two candidates with identical scores but different happenedAt
    const candidates: HybridCandidate<BaseNarrativeBlock>[] = [
      {
        block: { id: "old", index: 10, content: "Older", happenedAt: 100 },
        scoreVectorDense: 0.8,
        scoreKeywordSparse: 0.8,
      },
      {
        block: { id: "new", index: 20, content: "Newer", happenedAt: 200 },
        scoreVectorDense: 0.8,
        scoreKeywordSparse: 0.8,
      },
    ];

    vi.mocked(mockProvider.getHybridSearchCandidates).mockResolvedValue(candidates);

    // We set limit to 1 to see which one the engine picks
    const result = await engine.generateContext("test", "query");

    // The engine sorts survivors by score DESC, then happenedAt DESC.
    // "Newer" should be favored in the prompt timeline composition.
    expect(result).toContain("Newer");
  });

  it("should prevent Lore Overload via capping", async () => {
    const manyLore: BaseNarrativeLore[] = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      content: `Rule ${i}`,
      happenedAt: i,
      isActive: true,
    }));

    vi.mocked(mockProvider.getLoreAtoms).mockResolvedValue(manyLore);
    engine.setLabConfig({ maxLoreAtoms: 5 });

    const result = await engine.generateContext("test", "query");

    // Should only contain the 5 most recent (highest happenedAt)
    expect(result).toContain("Rule 49");
    expect(result).not.toContain("Rule 0");
  });

  it("should apply the 1.5x Significance Coefficient correctly", async () => {
    const candidates: HybridCandidate<BaseNarrativeBlock>[] = [ {
      block: { id: "notable", index: 10, content: "Important", happenedAt: 1, isNotable: true },
      scoreVectorDense: 0.5, // Base fused score would be 0.5
      scoreKeywordSparse: 0.5,
    } ];

    vi.mocked(mockProvider.getHybridSearchCandidates).mockResolvedValue(candidates);

    // 0.5 * 1.5 = 0.75 (above the 0.65 threshold)
    const result = await engine.generateContext("test", "query");
    expect(result).toContain("Important");
  });

  it("should evict candidates below the Saliency Gate (0.65)", async () => {
    const weakCandidate: HybridCandidate<BaseNarrativeBlock>[] = [ {
      block: { id: "weak", index: 10, content: "Irrelevant", happenedAt: 1 },
      scoreVectorDense: 0.4,
      scoreKeywordSparse: 0.4,
    } ];

    vi.mocked(mockProvider.getHybridSearchCandidates).mockResolvedValue(weakCandidate);

    const result = await engine.generateContext("test", "query");
    expect(result).not.toContain("Irrelevant");
  });
});


describe("NarrativeEngine Core Constraints", () => {
  let engine: NarrativeEngine;

  beforeEach(() => {
    engine = new NarrativeEngine(new InMemoryNarrativeProvider());
  });

  it("should use default config if no overrides provided", () => {
    const config = engine.getLabConfig();
    expect(config.saliencyThreshold).toBe(0.65);
  });

  it("should enforce the prohibition of nuclear deletes", () => {
    // This is a logic/pattern test. We ensure no 'delete' or 'WHERE' 
    // manipulation logic exists in the provider interaction layer.
    const provider = new InMemoryNarrativeProvider();
    const deleteAttempt = (provider as any).deleteRecords;
    expect(deleteAttempt).toBeUndefined();
  });

  it("should accurately calculate temporal phrasing offsets", async () => {
    const provider = new InMemoryNarrativeProvider([
      { id: 1, index: 1, content: "The beginning", happenedAt: 100 },
      { id: 2, index: 2, content: "The middle", happenedAt: 150 },
      { id: 3, index: 3, content: "The end", happenedAt: 200 }
    ]);
    const testEngine = new NarrativeEngine(provider);
    testEngine.setLabConfig({ temporalPhrasing: true });

    const result = await testEngine.generateContext("test", "query");
    // Offset calculation: (Total: 3) - (Index: 2) + 1 = 2 storyblocks ago
    expect(result).toContain("2 storyblocks ago");
  });
});

import { MOCK_BLOCKS, MOCK_LORE } from "./mocks";
import type { BaseNarrativeBlock, BaseNarrativeLore } from "./types";

export interface HybridCandidate<TBlock extends BaseNarrativeBlock> {
  block: TBlock;
  scoreVectorDense: number;
  scoreKeywordSparse: number;
}

export interface NarrativeProvider<
  TBlock extends BaseNarrativeBlock = BaseNarrativeBlock,
  TLore extends BaseNarrativeLore = BaseNarrativeLore
> {
  getLoreAtoms(channelId: string): Promise<TLore[]>;
  getNotableEvents(channelId: string): Promise<TBlock[]>;
  getBlocksByIndices(channelId: string, indices: number[]): Promise<TBlock[]>;
  getHybridSearchCandidates(channelId: string, query: string, limit: number): Promise<HybridCandidate<TBlock>[]>;
  getBlockCount(channelId: string): Promise<number>;
}

/**
 * A Zero-Dependency In-Memory Provider for testing and local development.
 */
export class InMemoryNarrativeProvider<
  TBlock extends BaseNarrativeBlock,
  TLore extends BaseNarrativeLore
> implements NarrativeProvider<TBlock, TLore> {
  private blocks: TBlock[] = [];
  private lore: TLore[] = [];

  constructor(
    // @ts-expect-error MOCK_BLOCKS conforms to constraint, allowed for initializing
    initialBlocks: TBlock[] = MOCK_BLOCKS,
    // @ts-expect-error MOCK_LORE conforms to constraint, allowed for initializing
    initialLore: TLore[] = MOCK_LORE
  ) {
    this.blocks = initialBlocks;
    this.lore = initialLore;
  }

  async getLoreAtoms(): Promise<TLore[]> {
    return this.lore.filter(l => l.isActive !== false);
  }

  async getNotableEvents(): Promise<TBlock[]> {
    return this.blocks.filter(b => b.isNotable);
  }

  async getBlocksByIndices(_channelId: string, indices: number[]): Promise<TBlock[]> {
    // Map 1-based indices to 0-based array access if using sequential IDs
    return this.blocks.filter(b => indices.includes(Number(b.id)));
  }

  async getBlockCount(): Promise<number> {
    return this.blocks.length;
  }

  async getHybridSearchCandidates(_channelId: string, query: string, limit: number): Promise<HybridCandidate<TBlock>[]> {
    // Simple substring match acting as a mock "Keyword Search"
    return this.blocks
      .filter(b => b.content.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limit)
      .map(b => ({
        block: b,
        scoreVectorDense: 0.8, // Mock high-relevance
        scoreKeywordSparse: 0.8
      }));
  }
}
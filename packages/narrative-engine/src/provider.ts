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
  getBlockCount(channelId: string): Promise<number>;
  getLoreAtoms(channelId: string): Promise<TLore[]>;
  getHybridSearchCandidates(channelId: string, query: string, limit: number): Promise<HybridCandidate<TBlock>[]>;
  getBlocksByIndices(channelId: string, indices: number[]): Promise<TBlock[]>;
  getNotableEvents(channelId: string): Promise<TBlock[]>;
  addBlock?(channelId: string, block: TBlock): Promise<void>;
  getProviderType?(): string;
}

/**
 * Storage adapter for browser localStorage
 */
function getBrowserStorage<T>(key: string, fallback: T[]): T[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return fallback;
  }
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function setBrowserStorage<T>(key: string, data: T[]): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Storage full or unavailable
  }
}

/**
 * A Zero-Dependency In-Memory Provider for testing and local development.
 * Supports persisting blocks to browser localStorage.
 */
export class InMemoryNarrativeProvider<
  TBlock extends BaseNarrativeBlock,
  TLore extends BaseNarrativeLore
> implements NarrativeProvider<TBlock, TLore> {
  private blocks: TBlock[] = [];
  private lore: TLore[] = [];
  private storageKeyBlocks: string;
  private storageKeyLore: string;
  private useBrowserStorage: boolean;

  constructor(
    // @ts-expect-error MOCK_BLOCKS conforms to constraint, allowed for initializing
    initialBlocks: TBlock[] = MOCK_BLOCKS,
    // @ts-expect-error MOCK_LORE conforms to constraint, allowed for initializing
    initialLore: TLore[] = MOCK_LORE,
    options?: { useBrowserStorage?: boolean; channelId?: string; }
  ) {
    this.useBrowserStorage = options?.useBrowserStorage ?? false;
    const channelId = options?.channelId ?? "default";

    this.storageKeyBlocks = `narrative_blocks_${channelId}`;
    this.storageKeyLore = `narrative_lore_${channelId}`;

    if (this.useBrowserStorage) {
      // Load from browser storage
      this.blocks = getBrowserStorage(this.storageKeyBlocks, initialBlocks);
      this.lore = getBrowserStorage(this.storageKeyLore, initialLore);
    } else {
      this.blocks = initialBlocks;
      this.lore = initialLore;
    }
  }

  getProviderType(): string {
    return this.useBrowserStorage ? "browser-storage" : "in-memory";
  }

  async getLoreAtoms(_channelId: string): Promise<TLore[]> {
    return this.lore.filter(l => l.isActive !== false);
  }

  async getNotableEvents(_channelId: string): Promise<TBlock[]> {
    return this.blocks.filter(b => b.isNotable);
  }

  async getBlocksByIndices(_channelId: string, indices: number[]): Promise<TBlock[]> {
    // Map 1-based indices to 0-based array access if using sequential IDs
    return this.blocks.filter(b => indices.includes(Number(b.id)));
  }

  async getBlockCount(_channelId: string): Promise<number> {
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

  async addBlock(_channelId: string, block: TBlock): Promise<void> {
    this.blocks.push(block);

    // Persist to browser storage if enabled
    if (this.useBrowserStorage) {
      setBrowserStorage(this.storageKeyBlocks, this.blocks);
    }
  }
}
import { type NarrativeProvider, type HybridCandidate, InMemoryNarrativeProvider } from "./provider";
import type { BaseNarrativeBlock, BaseNarrativeLore } from "./types";
import { RAG_DIVISIONS, RAG_MIN_BLOCKS, generateReciprocalSequence, sequenceToBlockIndices } from "./sequence";
import { loggerNarrativeTrace, TraceObject } from "./trace";

const LIMIT_HYBRID_TOP = 3;

export interface LabConfig {
  saliencyThreshold?: number;
  weightDense?: number;
  significanceCoef?: number;
  temporalPhrasing?: boolean;
  maxLoreAtoms?: number; // Hardening against Lore Overload
  timestamp?: string | null;
}

const DEFAULT_LAB_CONFIG: Required<LabConfig> = {
  saliencyThreshold: 0.65,
  weightDense: 0.7,
  significanceCoef: 1.5,
  temporalPhrasing: true,
  maxLoreAtoms: 20,
  timestamp: new Date().toISOString(),
};

export class NarrativeEngine<
  TBlock extends BaseNarrativeBlock = BaseNarrativeBlock,
  TLore extends BaseNarrativeLore = BaseNarrativeLore
> {
  private labConfig: Required<LabConfig> = { ...DEFAULT_LAB_CONFIG };

  constructor(private provider: NarrativeProvider<TBlock, TLore> = new InMemoryNarrativeProvider()) { }

  setLabConfig(config: LabConfig): void {
    this.labConfig = {
      saliencyThreshold: config.saliencyThreshold ?? DEFAULT_LAB_CONFIG.saliencyThreshold,
      weightDense: config.weightDense ?? DEFAULT_LAB_CONFIG.weightDense,
      significanceCoef: config.significanceCoef ?? DEFAULT_LAB_CONFIG.significanceCoef,
      temporalPhrasing: config.temporalPhrasing ?? DEFAULT_LAB_CONFIG.temporalPhrasing,
      maxLoreAtoms: config.maxLoreAtoms ?? DEFAULT_LAB_CONFIG.maxLoreAtoms,
      timestamp: config.timestamp ?? DEFAULT_LAB_CONFIG.timestamp,
    };
  }

  getLabConfig(): Required<LabConfig> {
    return { ...this.labConfig };
  }

  async generateContext(channelId: string, inputQuery: string): Promise<string> {
    const trace: TraceObject = {
      timestamp: new Date().toISOString(),
      channelId,
      inputQuery,
      labConfig: { ...this.labConfig },
      phases: {},
    };

    try {
      // 1. HARVEST PHASE
      const totalBlockCount = await this.provider.getBlockCount(channelId);
      const loreAtomsRaw = await this.provider.getLoreAtoms(channelId);

      // LOGIC: Lore Overload Protection (Sort by recency, then cap)
      const loreAtoms = loreAtomsRaw
        .sort((a, b) => b.happenedAt - a.happenedAt)
        .slice(0, this.labConfig.maxLoreAtoms);

      const candidatesHybrid = await this.provider.getHybridSearchCandidates(channelId, inputQuery, 20);

      // Reciprocal Skeleton
      let blocksHistorical: TBlock[] = [];
      if (totalBlockCount >= RAG_MIN_BLOCKS) {
        const seq = generateReciprocalSequence(totalBlockCount, RAG_DIVISIONS);
        const indices = sequenceToBlockIndices(seq);
        blocksHistorical = await this.provider.getBlocksByIndices(channelId, indices);
      }

      // 2. FUSION & SCORING PHASE
      const weightSparse = 1 - this.labConfig.weightDense;
      const scoredCandidates = candidatesHybrid.map((candidate) => {
        const scoreRawFused =
          candidate.scoreVectorDense * this.labConfig.weightDense +
          candidate.scoreKeywordSparse * weightSparse;

        const scoreFinalFused = candidate.block.isNotable
          ? scoreRawFused * this.labConfig.significanceCoef
          : scoreRawFused;

        return {
          ...candidate,
          scoreFinalFused,
        };
      });

      // 3. SALIENCY GATE & TIE-BREAKER
      // LOGIC: Secondary sort on happenedAt (Temporal Vector) for deterministic tie-breaking
      const survivors = scoredCandidates
        .filter((c) => c.scoreFinalFused >= this.labConfig.saliencyThreshold)
        .sort((a, b) =>
          b.scoreFinalFused - a.scoreFinalFused ||
          b.block.happenedAt - a.block.happenedAt
        )
        .slice(0, LIMIT_HYBRID_TOP);

      // 4. TIMELINE ALIGNMENT
      const blocksChrono = this.mergeAndSortChronologically(blocksHistorical, survivors);

      // 5. PROSE GENERATION
      const finalizedPrompt = this.composeProse(
        blocksChrono,
        loreAtoms,
        inputQuery,
        totalBlockCount
      );

      trace.phases = {
        harvest: { totalBlockCount, loreCount: loreAtoms.length },
        fusion: scoredCandidates.map(c => ({ id: c.block.id, score: c.scoreFinalFused })),
        saliency: survivors.map(s => s.block.id),
        timeline: blocksChrono.map(b => b.id),
      };
      trace.finalizedPrompt = finalizedPrompt;

      loggerNarrativeTrace(trace);
      return finalizedPrompt;
    } catch (err) {
      trace.error = err instanceof Error ? err.message : String(err);
      loggerNarrativeTrace(trace);
      throw err;
    }
  }

  private mergeAndSortChronologically(
    blocksHistorical: TBlock[],
    candidatesSurvivor: HybridCandidate<TBlock>[]
  ): TBlock[] {
    const merged = new Map<string | number, TBlock>();
    for (const block of blocksHistorical) {
      merged.set(block.id, block);
    }
    for (const candidate of candidatesSurvivor) {
      merged.set(candidate.block.id, candidate.block);
    }
    // Sort strictly by the Temporal Vector
    return Array.from(merged.values()).sort((a, b) => a.happenedAt - b.happenedAt);
  }

  private composeProse(
    blocksChrono: TBlock[],
    loreAtoms: TLore[],
    immediateContext: string,
    totalBlockCount: number
  ): string {
    const loreSection = loreAtoms.length > 0
      ? loreAtoms.map((l) => l.content).join(" ")
      : "";

    const blockSections = blocksChrono.map((block) => {
      if (this.labConfig.temporalPhrasing && typeof block.index === 'number') {
        // Offset is calculated relative to the max temporal position provided
        const offsetHistorical = totalBlockCount - block.index + 1;
        const unit = offsetHistorical === 1 ? "storyblock" : "storyblocks";
        return `${offsetHistorical} ${unit} ago, ${block.content}`;
      }
      return `[Entry ${block.id}]: ${block.content}`;
    });

    const parts: string[] = [];
    if (loreSection) {
      parts.push(`To maintain consistency with the established story: ${loreSection}`);
    }
    if (blockSections.length > 0) {
      parts.push(blockSections.join(" "));
    }
    parts.push(`Current: ${immediateContext}`);

    return parts.join("\n\n");
  }
}
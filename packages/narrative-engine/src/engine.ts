import { type NarrativeProvider, type HybridCandidate, InMemoryNarrativeProvider } from "./provider";
import type { BaseNarrativeBlock, BaseNarrativeLore } from "./types";
import { RAG_DIVISIONS, RAG_MIN_BLOCKS, generateReciprocalSequence, sequenceToBlockIndices } from "./sequence";
import { loggerNarrativeTrace, TraceObject } from "./trace";

const LIMIT_HYBRID_TOP = 3;

/**
 * Verbose logger for NarrativeEngine internals.
 * Provides detailed visibility into each phase of the RAG pipeline.
 */
const verboseLog = {
  group: (label: string, ...args: unknown[]) => {
    if (process.env.NARRATIVE_VERBOSE === "true" || process.env.NODE_ENV === "development") {
      console.group(`[NarrativeEngine] ${label}`);
      args.forEach((arg) => {
        if (typeof arg === "object") {
          console.log(JSON.stringify(arg, null, 2));
        } else {
          console.log(arg);
        }
      });
      console.groupEnd();
    }
  },
  info: (label: string, ...args: unknown[]) => {
    if (process.env.NARRATIVE_VERBOSE === "true" || process.env.NODE_ENV === "development") {
      console.info(`[NarrativeEngine] ℹ️ ${label}`, ...args);
    }
  },
  debug: (label: string, ...args: unknown[]) => {
    if (process.env.NARRATIVE_VERBOSE === "true" || process.env.NODE_ENV === "development") {
      console.debug(`[NarrativeEngine] 🔍 ${label}`, ...args);
    }
  },
  warn: (label: string, ...args: unknown[]) => {
    if (process.env.NARRATIVE_VERBOSE === "true" || process.env.NODE_ENV === "development") {
      console.warn(`[NarrativeEngine] ⚠️ ${label}`, ...args);
    }
  },
  success: (label: string, ...args: unknown[]) => {
    if (process.env.NARRATIVE_VERBOSE === "true" || process.env.NODE_ENV === "development") {
      console.log(`[NarrativeEngine] ✅ ${label}`, ...args);
    }
  },
  phase: (phase: string, message: string, data?: unknown) => {
    if (process.env.NARRATIVE_VERBOSE === "true" || process.env.NODE_ENV === "development") {
      const divider = "─".repeat(50);
      console.log(`\n${divider}`);
      console.log(`🚀 PHASE: ${phase}`);
      console.log(`   ${message}`);
      if (data !== undefined) {
        if (typeof data === "object") {
          console.log(JSON.stringify(data, null, 4).split("\n").map((l) => `   ${l}`).join("\n"));
        } else {
          console.log(`   ${data}`);
        }
      }
      console.log(divider);
    }
  },
  table: (label: string, data: unknown[]) => {
    if (process.env.NARRATIVE_VERBOSE === "true" || process.env.NODE_ENV === "development") {
      console.log(`[NarrativeEngine] 📊 ${label}`);
      console.table(data);
    }
  },
};

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
    verboseLog.phase("CONTEXT_GENERATION", `Starting for channel="${channelId}", query="${inputQuery.substring(0, 50)}${inputQuery.length > 50 ? "..." : ""}"`);

    const trace: TraceObject = {
      timestamp: new Date().toISOString(),
      channelId,
      inputQuery,
      labConfig: { ...this.labConfig },
      providerType: this.provider.getProviderType?.() ?? "custom",
      phases: {},
    };

    try {
      // PHASE 1: HARVEST
      verboseLog.phase("HARVEST", "Fetching blocks, lore atoms, and hybrid search candidates");
      verboseLog.debug("LabConfig", this.labConfig);

      // Get total blocks from provider
      const totalBlockCount = await this.provider.getBlockCount(channelId);
      verboseLog.info("BlockCount", `totalBlockCount=${totalBlockCount}`);

      // Get lore atoms
      const loreAtomsRaw = await this.provider.getLoreAtoms(channelId);
      verboseLog.info("LoreAtomsRaw", `found=${loreAtomsRaw.length} atoms`);

      // Lore Overload Protection: sort by recency, cap at maxLoreAtoms
      const loreAtoms = loreAtomsRaw
        .sort((a, b) => b.happenedAt - a.happenedAt)
        .slice(0, this.labConfig.maxLoreAtoms);

      verboseLog.info("LoreAtomsCapped", {
        raw: loreAtomsRaw.length,
        active: loreAtoms.length,
        maxAllowed: this.labConfig.maxLoreAtoms,
        oldestIncluded: loreAtoms.length > 0 ? loreAtoms[loreAtoms.length - 1].happenedAt : null,
        newestIncluded: loreAtoms.length > 0 ? loreAtoms[0].happenedAt : null,
      });

      // Get search candidates
      const candidatesHybrid = await this.provider.getHybridSearchCandidates(channelId, inputQuery, 20);
      verboseLog.info("HybridCandidates", `found=${candidatesHybrid.length} candidates`);
      if (candidatesHybrid.length > 0) {
        verboseLog.table("HybridCandidates.Sample", candidatesHybrid.slice(0, 5).map((c) => ({
          id: c.block.id,
          dense: c.scoreVectorDense.toFixed(3),
          sparse: c.scoreKeywordSparse.toFixed(3),
          notable: c.block.isNotable,
          snippet: c.block.content,
        })));
      }

      // Get historical blocks via reciprocal skeleton
      let blocksHistorical: TBlock[] = [];
      let blockSequenceIntervals: number[] = [];
      if (totalBlockCount >= RAG_MIN_BLOCKS) {
        const seq = generateReciprocalSequence(totalBlockCount, RAG_DIVISIONS);
        const indices = sequenceToBlockIndices(seq);
        blockSequenceIntervals = indices;
        verboseLog.debug("ReciprocalSkeleton", {
          totalBlocks: totalBlockCount,
          divisions: RAG_DIVISIONS,
          rawSequence: seq,
          blockIndices: indices,
        });
        blocksHistorical = await this.provider.getBlocksByIndices(channelId, indices);
        verboseLog.info("HistoricalBlocks", `retrieved=${blocksHistorical.length} blocks via reciprocal skeleton`);
      } else {
        verboseLog.warn("ReciprocalSkeleton", `Skipped - blockCount(${totalBlockCount}) < RAG_MIN_BLOCKS(${RAG_MIN_BLOCKS})`);
      }

      // PHASE 2: FUSION & SCORING
      verboseLog.phase("FUSION", "Applying weighted fusion and significance boost");

      const weightSparse = 1 - this.labConfig.weightDense;
      verboseLog.debug("FusionWeights", {
        weightDense: this.labConfig.weightDense,
        weightSparse: weightSparse.toFixed(3),
        formula: `scoreRaw = (dense * ${this.labConfig.weightDense}) + (sparse * ${weightSparse.toFixed(3)})`,
      });

      const scoredCandidates = candidatesHybrid.map((candidate) => {
        const scoreRawFused =
          candidate.scoreVectorDense * this.labConfig.weightDense +
          candidate.scoreKeywordSparse * weightSparse;

        const scoreFinalFused = candidate.block.isNotable
          ? scoreRawFused * this.labConfig.significanceCoef
          : scoreRawFused;

        verboseLog.debug("ScoredCandidate", {
          id: candidate.block.id,
          scoreDense: candidate.scoreVectorDense.toFixed(3),
          scoreSparse: candidate.scoreKeywordSparse.toFixed(3),
          scoreRaw: scoreRawFused.toFixed(3),
          isNotable: candidate.block.isNotable,
          significanceCoef: candidate.block.isNotable ? this.labConfig.significanceCoef : 1,
          scoreFinal: scoreFinalFused.toFixed(3),
        });

        return {
          ...candidate,
          scoreRawFused,
          scoreFinalFused,
        };
      });

      verboseLog.table("AllScoredCandidates", scoredCandidates.map((c) => ({
        id: c.block.id,
        raw: c.scoreRawFused.toFixed(3),
        final: c.scoreFinalFused.toFixed(3),
        notable: c.block.isNotable,
      })));

      // PHASE 3: SALIENCY GATE & TIE-BREAKER
      verboseLog.phase("SALIENCY_GATE", `Threshold=${this.labConfig.saliencyThreshold}, TopK=${LIMIT_HYBRID_TOP}`);

      const filteredBySaliency = scoredCandidates.filter((c) => c.scoreFinalFused >= this.labConfig.saliencyThreshold);
      verboseLog.info("SaliencyFilter", {
        total: scoredCandidates.length,
        passed: filteredBySaliency.length,
        threshold: this.labConfig.saliencyThreshold,
        evicted: scoredCandidates.length - filteredBySaliency.length,
      });

      const evicted = scoredCandidates.filter((c) => c.scoreFinalFused < this.labConfig.saliencyThreshold);
      if (evicted.length > 0) {
        verboseLog.warn("EvictedCandidates", evicted.map((e) => ({
          id: e.block.id,
          score: e.scoreFinalFused.toFixed(3),
          belowBy: (this.labConfig.saliencyThreshold - e.scoreFinalFused).toFixed(3),
        })));
      }

      const survivors = scoredCandidates
        .filter((c) => c.scoreFinalFused >= this.labConfig.saliencyThreshold)
        .sort((a, b) =>
          b.scoreFinalFused - a.scoreFinalFused ||
          b.block.happenedAt - a.block.happenedAt
        )
        .slice(0, LIMIT_HYBRID_TOP);

      verboseLog.success("Survivors", {
        count: survivors.length,
        maxAllowed: LIMIT_HYBRID_TOP,
        ids: survivors.map((s) => s.block.id),
        topScore: survivors[0]?.scoreFinalFused.toFixed(3) ?? null,
      });

      if (survivors.length > 0) {
        verboseLog.table("SurvivorRanking", survivors.map((s, i) => ({
          rank: i + 1,
          id: s.block.id,
          score: s.scoreFinalFused.toFixed(3),
          temporal: s.block.happenedAt,
          notable: s.block.isNotable,
        })));
      }

      // PHASE 4: TIMELINE ALIGNMENT
      verboseLog.phase("TIMELINE", "Merging historical skeleton with relevance survivors");

      const blocksChrono = this.mergeAndSortChronologically(blocksHistorical, survivors);

      verboseLog.info("TimelineMerge", {
        historicalBlocks: blocksHistorical.length,
        survivorBlocks: survivors.length,
        totalUnique: blocksChrono.length,
        deduped: (blocksHistorical.length + survivors.length) - blocksChrono.length,
      });

      verboseLog.table("FinalTimeline", blocksChrono.map((b, i) => ({
        position: i + 1,
        id: b.id,
        temporalOffset: `${totalBlockCount - (typeof b.index === "number" ? b.index : 0) + 1} blocks ago`,
        notable: b.isNotable,
        content: b.content,
      })));

      // PHASE 5: PROSE GENERATION
      verboseLog.phase("PROSE", "Composing final context prompt");

      const currentBlockCount = (blocksChrono.at(-1)?.index ?? 0) + 1;

      const finalizedPrompt = this.composeProse(
        blocksChrono,
        loreAtoms,
        inputQuery,
        currentBlockCount
      );

      verboseLog.debug("ProseStats", {
        loreSectionChars: loreAtoms.length > 0 ? loreAtoms.map((l) => l.content).join(" ").length : 0,
        blockSectionCount: blocksChrono.length,
        totalPromptChars: finalizedPrompt.length,
        temporalPhrasing: this.labConfig.temporalPhrasing,
      });

      // Build comprehensive trace with all data organized by execution order
      trace.phases = {
        harvest: {
          totalBlockCount,
          loreCount: loreAtoms.length,
          candidateCount: candidatesHybrid.length,
          loreAtoms: loreAtoms.map(l => ({ id: l.id, content: l.content, happenedAt: l.happenedAt })),
          searchCandidates: candidatesHybrid.map(c => ({
            id: c.block.id,
            content: c.block.content,
            scoreVectorDense: c.scoreVectorDense,
            scoreKeywordSparse: c.scoreKeywordSparse,
            isNotable: c.block.isNotable
          })),
          immediateContext: inputQuery,
        },
        fusion: scoredCandidates.map(c => ({
          id: c.block.id,
          scoreFinal: c.scoreFinalFused,
          scoreRaw: c.scoreRawFused,
          isNotable: c.block.isNotable
        })),
        saliency: {
          threshold: this.labConfig.saliencyThreshold,
          passed: survivors.map(s => s.block.id),
          evicted: evicted.map(e => e.block.id),
          filteredCount: filteredBySaliency.length,
          totalCandidates: scoredCandidates.length,
        },
        timeline: {
          merged: blocksChrono.map(b => ({ id: b.id, index: b.index, content: b.content })),
          fromHistorical: blocksHistorical.map(b => b.id),
          fromSurvivors: survivors.map(s => s.block.id),
          blockSequenceIntervals,
          currentBlockCount,
        },
        prose: { promptLength: finalizedPrompt.length, loreAtoms: loreAtoms.length, blockCount: blocksChrono.length },
      };
      trace.finalizedPrompt = finalizedPrompt;

      loggerNarrativeTrace(trace);
      verboseLog.success("ContextGenerated", `Prompt length: ${finalizedPrompt.length} chars`);
      return finalizedPrompt;
    } catch (err) {
      verboseLog.warn("Error", err instanceof Error ? err.message : String(err));
      trace.error = err instanceof Error ? err.message : String(err);
      loggerNarrativeTrace(trace);
      throw err;
    }
  }

  private mergeAndSortChronologically(
    blocksHistorical: TBlock[],
    candidatesSurvivor: HybridCandidate<TBlock>[]
  ): TBlock[] {
    verboseLog.debug("MergeStart", {
      historical: blocksHistorical.length,
      survivors: candidatesSurvivor.length,
    });

    const merged = new Map<string | number, TBlock>();
    for (const block of blocksHistorical) {
      merged.set(block.id, block);
    }

    const dupsFromSurvivors: string[] = [];
    for (const candidate of candidatesSurvivor) {
      if (merged.has(candidate.block.id)) {
        dupsFromSurvivors.push(String(candidate.block.id));
      }
      merged.set(candidate.block.id, candidate.block);
    }

    if (dupsFromSurvivors.length > 0) {
      verboseLog.info("DuplicateBlocks", `Survivors overlapping with historical: ${dupsFromSurvivors.join(", ")}`);
    }

    const result = Array.from(merged.values()).sort((a, b) => a.happenedAt - b.happenedAt);

    verboseLog.debug("MergeComplete", {
      inputHistorical: blocksHistorical.length,
      inputSurvivors: candidatesSurvivor.length,
      duplicates: dupsFromSurvivors.length,
      output: result.length,
    });

    return result;
  }

  private composeProse(
    blocksChrono: TBlock[],
    loreAtoms: TLore[],
    immediateContext: string,
    currentBlockCount: number
  ): string {
    const loreSection = loreAtoms.length > 0
      ? loreAtoms.map((l) => l.content).join(" ")
      : "";

    verboseLog.debug("LoreSection", {
      hasLore: loreAtoms.length > 0,
      atomCount: loreAtoms.length,
      totalChars: loreSection.length,
      preview: loreSection.substring(0, 100) + (loreSection.length > 100 ? "..." : ""),
    });

    const blockSections = blocksChrono.map((block) => {
      if (this.labConfig.temporalPhrasing && typeof block.index === 'number') {
        const offsetHistorical = currentBlockCount - block.index + 1;
        const unit = offsetHistorical === 1 ? "storyblock" : "storyblocks";
        return `${offsetHistorical} ${unit} ago: ${block.content}`;
      }
      return `Entry ${block.id}: ${block.content}`;
    });

    verboseLog.debug("BlockSections", {
      blockCount: blocksChrono.length,
      temporalPhrasing: this.labConfig.temporalPhrasing,
      samples: blockSections.slice(0, 2).map((s) => s.substring(0, 60) + "..."),
    });

    const parts: string[] = [];
    if (loreSection) {
      parts.push(`Essential facts of the story: ${loreSection}`);
    }
    if (blockSections.length > 0) {
      parts.push(blockSections.join("\n"));
    }
    parts.push(`${immediateContext}`);

    const result = parts.join("\n");
    verboseLog.debug("ProseComplete", {
      sections: parts.length,
      totalChars: result.length,
    });

    return result;
  }
}
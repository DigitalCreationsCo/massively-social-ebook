import {
  QueueBroadcastClient,
  QueueBroadcastError,
  type QueueBroadcastJob,
} from "@portalshq/capability-queue-broadcast";
import { generateUUID } from "@portalshq/capability-realtime-fanout";
import type { ActivationResult, TickResult } from "@portalshq/runtime-core";
import type { Session } from "@shared/schema";

import { logger } from "../logger";
import { storage } from "../storage";
import {
  finishCanonicalSlot,
  hydrateCanonicalSlot,
  prepareAmbientSlots,
  prepareCanonicalSlot,
  prepareCanonicalText,
  slotsFromBlock,
  type CanonicalText,
  type PreparedAmbientTurn,
  type PreparedBroadcastSlot,
} from "./media-slots";
import { AmbientPipeline, type AmbientPipelineStatus } from "./ambient-pipeline";

type DesiredState = "running" | "stopped";
type BroadcastMode = "stopped" | "waiting_for_streamer" | "ambient" | "preparing" | "episode";
type StreamerAvailabilityState = "unknown" | "available" | "unavailable";

export interface StreamerAvailabilityStatus {
  state: StreamerAvailabilityState;
  lastCheckedAt?: number;
  lastSuccessfulAt?: number;
  retryAt?: number;
  reason?: string;
}

export interface BroadcastCoordinatorStatus {
  desiredState: DesiredState;
  mode: BroadcastMode;
  sessionStatus: "none" | "scheduled" | "preparing" | "active" | "completed";
  activeSessionId?: number;
  runId?: string;
  currentJobs?: { jobIds: string[] };
  lastError?: string;
  streamer: StreamerAvailabilityStatus;
  ambient?: AmbientPipelineStatus;
}

const PRE_ROLL_MS = 3 * 60 * 1000;
const RETRY_DELAYS_MS = [500, 1_500, 4_000];
const STREAMER_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000];

/**
 * Version 0.1.2 of queue-broadcast accepts a caller signal on these probes.
 * Keep the cast here while applications that still have 0.1.1 declarations in
 * node_modules upgrade; `awaitWithAbort` preserves prompt coordinator shutdown
 * even if that older implementation ignores the extra argument at runtime.
 */
type AbortableQueueProbeClient = {
  health(options?: { signal?: AbortSignal }): ReturnType<QueueBroadcastClient["health"]>;
  getPlayback(options?: { signal?: AbortSignal }): ReturnType<QueueBroadcastClient["getPlayback"]>;
};

/** Declared locally so an application with an older installed SDK fails safely. */
type SlotQueueClient = {
  stageUpload(input: Record<string, unknown>): Promise<QueueBroadcastJob>;
  releaseSlot(slotKey: string, options?: { signal?: AbortSignal }): Promise<{ jobs: QueueBroadcastJob[] }>;
};

export class BroadcastCoordinator {
  private desiredState: DesiredState = "stopped";
  private hasStoredDesiredState = false;
  private mode: BroadcastMode = "stopped";
  private sessionStatus: BroadcastCoordinatorStatus["sessionStatus"] = "none";
  private activeSessionId: number | undefined;
  private runId: string | undefined;
  private abortController: AbortController | undefined;
  private producerPromise: Promise<void> | undefined;
  private ambientSequence = 0;
  private ambientPipeline: AmbientPipeline | undefined;
  private currentJobs: BroadcastCoordinatorStatus["currentJobs"];
  private lastError: string | undefined;
  private streamer: StreamerAvailabilityStatus = { state: "unknown" };
  private streamerFailureCount = 0;
  private prefetchedCanonicalText:
    | { sessionId: number; previousContext: string; promise: Promise<CanonicalText> }
    | undefined;

  constructor(
    readonly channelId: string,
    private readonly client: QueueBroadcastClient,
  ) {}

  async initialize(): Promise<void> {
    const stored = await storage.getSystemSetting(this.desiredSettingKey());
    this.hasStoredDesiredState = stored === "running" || stored === "stopped";
    this.desiredState = stored === "running" ? "running" : "stopped";
    if (this.desiredState === "running") this.startProducer();
  }

  async activate(): Promise<ActivationResult> {
    if (this.hasStoredDesiredState && this.desiredState === "stopped") return false;
    if (this.desiredState === "running") {
      this.startProducer();
      return true;
    }

    const next = await storage.getNextSession(this.channelId);
    if (!next) return false;
    const preRollAt = next.scheduledStart.getTime() - PRE_ROLL_MS;
    if (Date.now() < preRollAt) return { scheduleRecheckAt: preRollAt };
    await this.restart("schedule");
    return true;
  }

  async tick(): Promise<TickResult> {
    if (this.desiredState !== "running") return { continue: false };
    this.startProducer();
    return { continue: true };
  }

  async stop(): Promise<void> {
    this.hasStoredDesiredState = true;
    this.desiredState = "stopped";
    this.mode = "stopped";
    this.prefetchedCanonicalText = undefined;
    await storage.setSystemSetting(this.desiredSettingKey(), "stopped");
    this.abortController?.abort(new Error("Broadcast stopped by operator"));
    await this.producerPromise?.catch(() => undefined);
    await this.disposeAmbientPipeline();
    this.abortController = undefined;
    this.producerPromise = undefined;
    this.currentJobs = undefined;
  }

  async restart(trigger: "operator" | "schedule" = "operator"): Promise<void> {
    this.abortController?.abort(new Error(`Broadcast restarted by ${trigger}`));
    await this.producerPromise?.catch(() => undefined);
    await this.disposeAmbientPipeline(new Error(`Broadcast restarted by ${trigger}`));
    this.prefetchedCanonicalText = undefined;
    this.hasStoredDesiredState = true;
    this.desiredState = "running";
    this.runId = generateUUID();
    this.ambientSequence = 0;
    this.lastError = undefined;
    this.streamer = { state: "unknown" };
    this.streamerFailureCount = 0;
    await storage.setSystemSetting(this.desiredSettingKey(), "running");
    this.startProducer();
  }

  /** Stop local work for process shutdown without changing the persisted desired state. */
  async shutdown(): Promise<void> {
    this.prefetchedCanonicalText = undefined;
    this.abortController?.abort(new Error("Broadcast process shutting down"));
    await this.producerPromise?.catch(() => undefined);
    await this.disposeAmbientPipeline(new Error("Broadcast process shutting down"));
    this.abortController = undefined;
    this.producerPromise = undefined;
    this.currentJobs = undefined;
  }

  getStatus(): BroadcastCoordinatorStatus {
    return {
      desiredState: this.desiredState,
      mode: this.mode,
      sessionStatus: this.sessionStatus,
      ...(this.activeSessionId ? { activeSessionId: this.activeSessionId } : {}),
      ...(this.runId ? { runId: this.runId } : {}),
      ...(this.currentJobs ? { currentJobs: this.currentJobs } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
      streamer: { ...this.streamer },
      ...(this.ambientPipeline ? { ambient: this.ambientPipeline.getStatus() } : {}),
    };
  }

  private startProducer(): void {
    if (this.producerPromise || this.desiredState !== "running") return;
    this.runId ??= generateUUID();
    const controller = new AbortController();
    this.abortController = controller;
    this.producerPromise = this.produce(controller.signal)
      .catch((cause) => {
        if (!controller.signal.aborted) {
          this.lastError = cause instanceof Error ? cause.message : String(cause);
          logger.error(
            `Broadcast producer stopped unexpectedly for ${this.channelId}`,
            "broadcast",
            cause instanceof Error ? cause : new Error(String(cause)),
          );
        }
      })
      .finally(() => {
        if (this.abortController === controller) this.abortController = undefined;
        this.producerPromise = undefined;
      });
  }

  private async produce(signal: AbortSignal): Promise<void> {
    while (!signal.aborted && this.desiredState === "running") {
      try {

        const scheduled = await storage.getNextSession(this.channelId);
        const active = await storage.getActiveSession(this.channelId);
        const session = active ?? scheduled;
        const now = Date.now();

        if (active && now >= active.scheduledEnd.getTime()) {
          await this.finishSession(active);
          continue;
        }

        const episodeDue = !!session && now >= session.scheduledStart.getTime();
        const preRollDue = !!scheduled && now >= scheduled.scheduledStart.getTime() - PRE_ROLL_MS;
        if (episodeDue || preRollDue) {
          // While the streamer is down, scheduled work remains visibly in
          // preparation; no narrative/media work has started yet.
          this.sessionStatus = "preparing";
        } else {
          this.sessionStatus = scheduled ? "scheduled" : "none";
        }

        if (!await this.ensureStreamerAvailable(signal)) {
          await this.waitForStreamerRetry(signal);
          continue;
        }

        if (episodeDue && session) {
          await this.disposeAmbientPipeline(new Error("Scheduled episode is due"));
          await this.produceEpisode(session, signal);
          continue;
        }

        if (preRollDue && scheduled) {
          this.mode = "preparing";
          this.sessionStatus = "preparing";
          await this.ensureStagedSlots(scheduled, 3, signal);
        }

        this.mode = "ambient";
        this.sessionStatus = scheduled ? "scheduled" : "none";
        const lastCanonical = await storage.getLastBlock(this.channelId);
        const pipeline = this.ensureAmbientPipeline(lastCanonical?.content || session?.description || "", signal);
        const next = await storage.getNextSession(this.channelId);
        const revision = pipeline.currentRevision();
        const released = await pipeline.releaseNextSafe(next?.scheduledStart.getTime() ?? null, signal);
        if (released.state === "released") {
          this.lastError = undefined;
          continue;
        }
        if (released.state === "blocked") {
          await wait(Math.max(0, released.episodeStart - Date.now()), signal);
          continue;
        }
        const progress = pipeline.waitForProgress(revision, signal);
        if (next) {
          await Promise.race([
            progress,
            wait(Math.max(0, next.scheduledStart.getTime() - Date.now()), signal),
          ]);
        } else {
          await progress;
        }
      } catch (cause) {
        if (signal.aborted) return;
        if (cause instanceof StreamerUnavailableError) {
          await this.waitForStreamerRetry(signal);
          continue;
        }
        this.lastError = cause instanceof Error ? cause.message : String(cause);
        logger.error(
          `Skipping failed broadcast segment for ${this.channelId}`,
          "broadcast",
          cause instanceof Error ? cause : new Error(String(cause)),
        );
        await wait(2_000, signal);
      }
    }
  }

  private ensureAmbientPipeline(previousCanonicalContext: string, signal: AbortSignal): AmbientPipeline {
    if (this.ambientPipeline) return this.ambientPipeline;
    // A generated narration may have multiple TTS segments.  The pipeline's
    // sequence is deliberately a *delivery-slot* sequence, while this counter
    // remains the idempotency sequence for a single AI generation turn.
    // Keeping the remaining segments locally means each one gets independent
    // staging, release, monitoring, and failure handling.
    const pendingSegments: PreparedAmbientTurn[] = [];
    // Narrowed generation mutex: prepareChain is held only during the fast check
    // and shift of pendingSegments or generationSequence reservation (< 1 microsecond).
    // Media generation runs outside the lock so multiple ambient turns generate in parallel.
    let prepareChain: Promise<void> = Promise.resolve();
    // Commit chain: ensures completed turns append their segments to pendingSegments
    // in strict generationSequence order, guaranteeing split-sibling contiguity.
    let commitChain: Promise<void> = Promise.resolve();
    const pipeline = new AmbientPipeline({
      initialSequence: this.ambientSequence,
      generateTurn: async (sequence, workerSignal) => {
        await this.requireStreamerAvailable(workerSignal);
        let next: PreparedAmbientTurn | undefined;
        let generationSequence: number | undefined;

        const previous = prepareChain;
        let release!: () => void;
        prepareChain = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try {
          workerSignal.throwIfAborted();
          next = pendingSegments.shift();
          if (!next) {
            generationSequence = this.ambientSequence++;
          }
        } finally {
          release();
        }

        if (next) return { ...next, sequence };

        // Media preparation runs OUTSIDE prepareChain: multiple workers generate in parallel.
        const turnPromise = prepareAmbientSlots(
          this.channelId,
          previousCanonicalContext,
          this.runId!,
          generationSequence!,
          workerSignal,
        );

        const previousCommit = commitChain;
        let commitRelease!: () => void;
        commitChain = new Promise<void>((resolve) => { commitRelease = resolve; });

        let turn: PreparedAmbientTurn | undefined;
        try {
          turn = await turnPromise;
        } finally {
          await previousCommit.catch(() => undefined);
          try {
            if (turn) {
              pendingSegments.push(...this.splitAmbientTurn(turn));
            }
            next = pendingSegments.shift();
          } finally {
            commitRelease();
          }
        }

        return next ? { ...next, sequence } : undefined;
      },
      stageTurn: async (turn, workerSignal) => {
        await this.requireStreamerAvailable(workerSignal);
        const slot = this.ambientTurnSlot(turn);
        try {
          await this.retrySlotOperation(() => this.stageSlot(slot, workerSignal), workerSignal);
        } catch (cause) {
          if (!(cause instanceof PartialSlotStageError)) throw cause;
          logger.warn(
            `Ambient narration upload failed; releasing its staged image without audio for ${this.channelId}`,
            "broadcast",
            cause,
            { sequence: turn.sequence, segmentOrdinal: slot.segmentOrdinal },
          );
        }
      },
      releaseTurn: async (turn, workerSignal) => {
        await this.requireStreamerAvailable(workerSignal);
        const slot = this.ambientTurnSlot(turn);
        const released = await this.retrySlotOperation(
          () => this.releaseStagedSlot(slot.slotKey, workerSignal),
          workerSignal,
        );
        return released.jobs;
      },
      monitorJobs: (jobs, workerSignal, onJobUpdate) => this.monitorSlotJobs(jobs, workerSignal, onJobUpdate),
      onError: (cause, phase, sequence) => this.reportAmbientPipelineError(cause, phase, sequence),
      onActiveJobsChanged: (jobIds) => {
        this.currentJobs = jobIds.length > 0 ? { jobIds } : undefined;
      },
      onMetrics: (metrics) => {
        if (metrics.monitoringEndedAt === undefined) return;
        logger.info(`Ambient turn ${metrics.sequence} completed`, "broadcast", {
          sequence: metrics.sequence,
          generationMs: metrics.generationMs,
          stagingMs: metrics.stagingMs,
          pipelineMs: metrics.pipelineMs,
          jobStateTransitions: metrics.jobStateTransitions,
        });
      },
    });
    pipeline.start(signal);
    this.ambientPipeline = pipeline;
    return pipeline;
  }

  private async disposeAmbientPipeline(reason = new Error("Ambient mode stopped")): Promise<void> {
    const pipeline = this.ambientPipeline;
    this.ambientPipeline = undefined;
    await pipeline?.abortAndAwaitAll(reason);
  }

  private splitAmbientTurn(turn: PreparedAmbientTurn): PreparedAmbientTurn[] {
    return turn.segments.map((segment) => ({
      ...turn,
      // Preserve contentId: split siblings share one visual identity so the
      // buffer counts distinct images, not delivery slots. Byte accounting
      // below stays per-slot (the Streamer stores a duplicate per slot).
      contentId: turn.contentId,
      segments: [segment],
      totalDurationSeconds: segment.durationSeconds,
      // The same image is intentionally sent with each segment so the
      // Streamer can make an independent image+audio composition. Count its
      // bytes for every remote slot; it is not a shared remote upload.
      // Video-safe: a future video turn would clone its own video bytes here
      // the same way; imageDuration below never applies to video uploads.
      totalBytes: turn.image.data.size + (segment.audio?.data.size ?? 0),
    }));
  }

  private ambientTurnSlot(turn: PreparedAmbientTurn): PreparedBroadcastSlot {
    const [segment] = turn.segments;
    if (!segment || turn.segments.length !== 1) {
      throw new Error(`Ambient pipeline turn ${turn.sequence} must contain exactly one segment`);
    }
    const idempotencyPrefix = `${turn.idempotencyPrefix}:segment:${segment.segmentOrdinal}`;
    return {
      durationSeconds: segment.durationSeconds,
      idempotencyPrefix,
      slotKey: `${idempotencyPrefix}:slot`,
      segmentOrdinal: segment.segmentOrdinal,
      image: turn.image,
      ...(segment.audio ? { audio: segment.audio } : {}),
    };
  }

  private reportAmbientPipelineError(
    cause: unknown,
    phase: "generation" | "staging" | "release" | "monitoring",
    sequence: number,
  ): void {
    if (cause instanceof StreamerUnavailableError) return;
    const error = cause instanceof Error ? cause : new Error(String(cause));
    this.lastError = error.message;
    logger.error(`Ambient turn ${sequence} failed during ${phase}`, "broadcast", error, { sequence, phase });
  }

  private async produceEpisode(session: Session, signal: AbortSignal): Promise<void> {
    this.mode = "preparing";
    this.sessionStatus = session.status === "active" ? "active" : "preparing";
    const cursorKey = this.cursorSettingKey(session.id);
    const cursor = Number(await storage.getSystemSetting(cursorKey) || 0);
    // Keep 3 slots staged ahead so the next image is already queued when the
    // current duration completes. Releases stay strictly serial (one playout
    // at a time); staging runs ahead, and each cycle's top-up generation
    // overlaps the current slot's playout instead of gating the next release.
    await this.ensureStagedSlots(session, cursor + 3, signal);
    if (Date.now() >= session.scheduledEnd.getTime()) {
      await this.finishSession(session);
      return;
    }

    const blocks = await storage.getBlocksBySessionOrdered(session.id);
    const slots = blocks.flatMap((block) => block.deliverySegments?.length ? slotsFromBlock(block) : []);
    const slot = slots[cursor];
    if (!slot) return;

    // Top up the NEXT slot concurrently while the current one plays: staging
    // (text + image generation, the slow part) overlaps monitoring instead of
    // serializing behind it. The promise is always awaited below before this
    // method returns, so top-ups never overlap across loop iterations and the
    // cursor still advances only after its own slot submitted cleanly.
    // The side-attached catch prevents an unhandled rejection while submit
    // runs; the later await rethrows so produce() still sees the failure.
    const topUp = this.ensureStagedSlots(session, cursor + 4, signal);
    topUp.catch(() => undefined);

    let markedActive = session.status === "active";
    try {
      await this.submitSlot(slot, signal, async () => {
        if (!markedActive) {
          await storage.updateSessionStatus(session.id, "active");
          markedActive = true;
        }
        this.mode = "episode";
        this.sessionStatus = "active";
        this.activeSessionId = session.id;
      });
    } catch (cause) {
      if (!(cause instanceof TerminalSlotError)) throw cause;
      logger.error(
        `Skipping terminal canonical slot ${slot.idempotencyPrefix}`,
        "broadcast",
        cause,
      );
    }
    await storage.setSystemSetting(cursorKey, String(cursor + 1));
    await topUp;
    this.lastError = undefined;
  }

  /**
   * Media work is deliberately behind this gate.  A healthy control endpoint
   * alone is insufficient: a bad queue token or an unavailable MediaMTX
   * instance would otherwise let us spend on generation that cannot air.
   */
  private async ensureStreamerAvailable(signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    const checkedAt = Date.now();

    try {
      const probeClient = this.client as unknown as AbortableQueueProbeClient;
      const health = await awaitWithAbort(probeClient.health({ signal }), signal);
      if (!health.ok) {
        throw new StreamerProbeError("Streamer reports that its media server is unavailable");
      }
      await awaitWithAbort(probeClient.getPlayback({ signal }), signal);
      this.slotClient();
      signal.throwIfAborted();

      const succeededAt = Date.now();
      this.streamer = {
        state: "available",
        lastCheckedAt: succeededAt,
        lastSuccessfulAt: succeededAt,
      };
      this.streamerFailureCount = 0;
      this.lastError = undefined;
      return true;
    } catch (cause) {
      if (signal.aborted) throw signal.reason;

      const retryDelay = STREAMER_RETRY_DELAYS_MS[
        Math.min(this.streamerFailureCount, STREAMER_RETRY_DELAYS_MS.length - 1)
      ]!;
      this.streamerFailureCount += 1;
      const reason = availabilityReason(cause);
      this.streamer = {
        state: "unavailable",
        lastCheckedAt: checkedAt,
        ...(this.streamer.lastSuccessfulAt !== undefined
          ? { lastSuccessfulAt: this.streamer.lastSuccessfulAt }
          : {}),
        retryAt: Date.now() + retryDelay,
        reason,
      };
      this.mode = "waiting_for_streamer";
      if (this.sessionStatus === "active") this.sessionStatus = "preparing";
      this.lastError = reason;
      logger.warn(
        `Broadcast production is waiting for Streamer on ${this.channelId}: ${reason}`,
        "broadcast",
      );
      // Stop all ongoing generation, staging, and release operations when streamer is unavailable
      await this.disposeAmbientPipeline(new Error(`Streamer unavailable: ${reason}`));
      return false;
    }
  }

  private async ensureStagedSlots(session: Session, minimumSlots: number, signal: AbortSignal): Promise<void> {
    await this.requireStreamerAvailable(signal);
    let blocks = await storage.getBlocksBySessionOrdered(session.id);
    // Recover canonical assets one receipt at a time. A crash after the image
    // upload but before audio no longer loses the valid image receipt.
    for (const block of blocks) {
      for (const slot of slotsFromBlock(block)) {
        if (slot.queuePairId || this.slotIsCompletelyStaged(block, slot)) continue;
        await this.stageCanonicalSlot(block, slot, signal);
      }
    }
    blocks = await storage.getBlocksBySessionOrdered(session.id);
    let slotCount = blocks.reduce(
      (count, block) => count + (block.deliverySegments?.length ?? 0),
      0,
    );
    while (slotCount < minimumSlots && Date.now() < session.scheduledEnd.getTime()) {
      signal.throwIfAborted();
      const previousContext = blocks.at(-1)?.content
        ?? (await storage.getLastBlock(this.channelId))?.content
        ?? "";
      await this.requireStreamerAvailable(signal);

      // Pipelined text/finish + prefetch:
      // Reuse prefetched text if it matches this session and previousContext;
      // otherwise initiate text generation.
      let textPromise: Promise<CanonicalText>;
      if (
        this.prefetchedCanonicalText
        && this.prefetchedCanonicalText.sessionId === session.id
        && this.prefetchedCanonicalText.previousContext === previousContext
      ) {
        textPromise = this.prefetchedCanonicalText.promise;
        this.prefetchedCanonicalText = undefined;
      } else {
        this.prefetchedCanonicalText = undefined;
        textPromise = prepareCanonicalText(this.channelId, previousContext, session.id, signal);
      }

      let generated: CanonicalText;
      try {
        generated = await textPromise;
      } catch (cause) {
        this.prefetchedCanonicalText = undefined;
        throw cause;
      }

      if (!generated?.content) {
        this.prefetchedCanonicalText = undefined;
        await wait(2_000, signal);
        return;
      }

      // Concurrently prefetch the NEXT turn's text while this turn's media,
      // archives, DB insert, and slot staging run.
      if (Date.now() < session.scheduledEnd.getTime()) {
        const nextContext = generated.content;
        const nextPromise = prepareCanonicalText(this.channelId, nextContext, session.id, signal);
        nextPromise.catch(() => undefined);
        this.prefetchedCanonicalText = {
          sessionId: session.id,
          previousContext: nextContext,
          promise: nextPromise,
        };
      }

      const prepared = await finishCanonicalSlot(this.channelId, session, generated, signal);
      // Generation failures are terminal for this turn, not the channel. Wait
      // before moving on so a persistent provider failure cannot busy-loop.
      if (!prepared?.block || prepared.slots.length === 0) {
        this.prefetchedCanonicalText = undefined;
        await wait(2_000, signal);
        return;
      }
      for (const slot of prepared.slots) {
        await this.stageCanonicalSlot(prepared.block, slot, signal);
      }
      blocks = [...blocks, prepared.block];
      slotCount += prepared.slots.length;
    }
  }

  private slotIsCompletelyStaged(
    block: Awaited<ReturnType<typeof storage.getBlocksBySessionOrdered>>[number],
    slot: PreparedBroadcastSlot,
  ): boolean {
    const segment = block.deliverySegments?.find((item) => item.ordinal === slot.segmentOrdinal);
    return Boolean(slot.imageJobId && (!segment?.audioUrl || segment.queueAudioUnavailable || slot.audioJobId));
  }

  private async stageCanonicalSlot(
    block: Awaited<ReturnType<typeof storage.getBlocksBySessionOrdered>>[number],
    slot: PreparedBroadcastSlot,
    signal: AbortSignal,
  ): Promise<void> {
    await this.requireStreamerAvailable(signal);
    const upload = slot.image ? slot : await hydrateCanonicalSlot(block, slot, signal);
    if (!upload.image) throw new Error("Canonical slot has no completed image bytes to stage");
    let imageJobId = upload.imageJobId;
    let audioJobId = upload.audioJobId;
    if (!imageJobId) {
      const stagedImage = await this.slotClient().stageUpload({
        mediaType: "image",
        asset: upload.image,
        imageDuration: safeImageDuration(upload.durationSeconds),
        idempotencyKey: `${upload.idempotencyPrefix}:image`,
        slotKey: upload.slotKey,
      });
      if (stagedImage.status === "failed") throw new TerminalSlotError("Streamer rejected staged image");
      imageJobId = stagedImage.id;
      await this.persistSlotReceipts(block, upload, imageJobId, audioJobId);
    }
    if (upload.audio && !audioJobId) {
      try {
        const stagedAudio = await this.retrySlotOperation(
          async () => {
            const result = await this.slotClient().stageUpload({
              mediaType: "audio",
              asset: upload.audio!,
              idempotencyKey: `${upload.idempotencyPrefix}:audio`,
              slotKey: upload.slotKey,
            });
            if (result.status === "failed") throw new TerminalSlotError("Streamer rejected staged audio");
            return result;
          },
          signal,
        );
        audioJobId = stagedAudio.id;
        await this.persistSlotReceipts(block, upload, imageJobId, audioJobId);
      } catch (cause) {
        // A capacity/transport failure is still a Streamer problem, not an
        // audio failure.  Let the availability/retry path recover it.  A
        // terminal media rejection, however, must not strand this image.
        if (isRetryable(cause)) throw cause;
        logger.warn(
          `Canonical narration upload failed; releasing its staged image without audio for ${this.channelId}`,
          "broadcast",
          cause instanceof Error ? cause : new Error(String(cause)),
          { blockId: block.id, segmentOrdinal: upload.segmentOrdinal },
        );
        await this.persistSlotReceipts(block, upload, imageJobId, undefined, true);
      }
    }
  }

  private async persistSlotReceipts(
    block: Awaited<ReturnType<typeof storage.getBlocksBySessionOrdered>>[number],
    slot: PreparedBroadcastSlot,
    imageJobId: string | undefined,
    audioJobId: string | undefined,
    audioUnavailable = false,
  ): Promise<void> {
    const existing = block.deliverySegments ?? [];
    const nextSegments = existing.map((segment) => {
      if (segment.ordinal !== slot.segmentOrdinal) return segment;
      const { queueAudioUnavailable: _queueAudioUnavailable, ...rest } = segment;
      return {
          ...rest,
          queueSlotKey: slot.slotKey,
          queueIdempotencyKey: slot.idempotencyPrefix,
          ...(imageJobId ? { queueImageJobId: imageJobId } : {}),
          ...(audioJobId ? { queueAudioJobId: audioJobId } : {}),
          ...(audioUnavailable ? { queueAudioUnavailable: true } : {}),
        };
    });
    await storage.updateBlock(block.id, { deliverySegments: nextSegments });
  }

  private async finishSession(session: Session): Promise<void> {
    if (session.status !== "completed") await storage.updateSessionStatus(session.id, "completed");
    this.activeSessionId = undefined;
    this.sessionStatus = "completed";
    this.mode = "ambient";
    this.prefetchedCanonicalText = undefined;
  }

  private async submitSlot(
    slot: PreparedBroadcastSlot,
    signal: AbortSignal,
    onSubmitted?: () => Promise<void>,
  ): Promise<void> {
    if (slot.queuePairId) {
      await this.submitLegacyPair(slot.queuePairId, signal, onSubmitted);
      return;
    }
    await this.requireStreamerAvailable(signal);
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      signal.throwIfAborted();
      try {
        const queued = await this.stageAndReleaseSlot(slot, signal);
        if (queued.jobs.length === 0) throw new TerminalSlotError("Streamer released an empty slot");
        this.currentJobs = { jobIds: queued.jobs.map((job) => job.id) };
        await onSubmitted?.();
        await this.monitorSlotJobs(queued.jobs, signal);
        this.currentJobs = undefined;
        return;
      } catch (cause) {
        this.currentJobs = undefined;
        if (cause instanceof TerminalSlotError || !isRetryable(cause) || attempt === RETRY_DELAYS_MS.length) {
          throw cause;
        }
        lastError = cause;
        await wait(RETRY_DELAYS_MS[attempt], signal);
      }
    }
    throw lastError;
  }

  private async waitForJob(
    jobId: string,
    signal: AbortSignal,
    onJobUpdate?: (job: QueueBroadcastJob) => void,
  ): Promise<QueueBroadcastJob> {
    let final: QueueBroadcastJob | undefined;
    for await (const job of this.client.watchJob(jobId, { signal, intervalMs: 1_000 })) {
      onJobUpdate?.(job);
      final = job;
    }
    signal.throwIfAborted();
    if (!final) throw new Error(`Queue job ${jobId} ended without a terminal state`);
    return final;
  }

  private async monitorSlotJobs(
    jobs: QueueBroadcastJob[],
    signal: AbortSignal,
    onJobUpdate?: (job: QueueBroadcastJob) => void,
  ): Promise<void> {
    const finalJobs = await Promise.all(jobs.map((job) => this.waitForJob(job.id, signal, onJobUpdate)));
    if (finalJobs.some((job) => job.status === "failed")) {
      throw new TerminalSlotError("A queued slot item failed during normalization or playout");
    }
  }

  private async stageAndReleaseSlot(
    slot: PreparedBroadcastSlot,
    signal: AbortSignal,
  ): Promise<{ jobs: QueueBroadcastJob[] }> {
    try {
      await this.retrySlotOperation(() => this.stageSlot(slot, signal), signal);
    } catch (cause) {
      if (!(cause instanceof PartialSlotStageError)) throw cause;
      logger.warn(
        `Narration upload failed; releasing its staged image without audio for ${this.channelId}`,
        "broadcast",
        cause,
        { segmentOrdinal: slot.segmentOrdinal },
      );
    }
    signal.throwIfAborted();
    return this.releaseStagedSlot(slot.slotKey, signal);
  }

  private async stageSlot(slot: PreparedBroadcastSlot, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    let imageJobId = slot.imageJobId;
    if (!imageJobId) {
      if (!slot.image) throw new Error(`Slot ${slot.idempotencyPrefix} is missing completed image bytes`);
      const image = await this.slotClient().stageUpload({
        mediaType: "image",
        asset: slot.image,
        imageDuration: safeImageDuration(slot.durationSeconds),
        idempotencyKey: `${slot.idempotencyPrefix}:image`,
        slotKey: slot.slotKey,
      });
      if (image.status === "failed") throw new TerminalSlotError("Streamer rejected staged image");
      imageJobId = image.id;
    }
    if (slot.audio && !slot.audioJobId) {
      signal.throwIfAborted();
      try {
        const audio = await this.slotClient().stageUpload({
          mediaType: "audio",
          asset: slot.audio,
          idempotencyKey: `${slot.idempotencyPrefix}:audio`,
          slotKey: slot.slotKey,
        });
        if (audio.status === "failed") {
          throw new Error("Streamer rejected staged audio");
        }
      } catch (cause) {
        // The image has already been safely staged under an idempotent key.
        // Preserve it as an image-only item rather than stranding it when the
        // optional narration upload exhausts its retries.
        throw new PartialSlotStageError(imageJobId!, cause);
      }
    }
    signal.throwIfAborted();
  }

  private async releaseStagedSlot(
    slotKey: string,
    signal: AbortSignal,
  ): Promise<{ jobs: QueueBroadcastJob[] }> {
    signal.throwIfAborted();
    return this.slotClient().releaseSlot(slotKey, { signal });
  }

  private async retrySlotOperation<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      signal.throwIfAborted();
      try {
        return await operation();
      } catch (cause) {
        if (cause instanceof TerminalSlotError || !isRetryable(cause) || attempt === RETRY_DELAYS_MS.length) {
          throw cause;
        }
        lastError = cause;
        await wait(RETRY_DELAYS_MS[attempt]!, signal);
      }
    }
    throw lastError;
  }

  private async submitLegacyPair(
    pairId: string,
    signal: AbortSignal,
    onSubmitted?: () => Promise<void>,
  ): Promise<void> {
    const queued = await this.client.releasePair(pairId, { signal });
    this.currentJobs = { jobIds: [queued.image.id, queued.audio.id] };
    await onSubmitted?.();
    const finalJobs = await Promise.all([
      this.waitForJob(queued.image.id, signal),
      this.waitForJob(queued.audio.id, signal),
    ]);
    this.currentJobs = undefined;
    if (finalJobs.some((job) => job.status === "failed")) {
      throw new TerminalSlotError("A legacy queue pair failed during normalization or playout");
    }
  }

  private async requireStreamerAvailable(signal: AbortSignal): Promise<void> {
    if (!await this.ensureStreamerAvailable(signal)) throw new StreamerUnavailableError();
  }

  private slotClient(): SlotQueueClient {
    const client = this.client as unknown as Partial<SlotQueueClient>;
    if (typeof client.stageUpload !== "function" || typeof client.releaseSlot !== "function") {
      throw new StreamerProbeError(
        "Installed queue-broadcast package does not support independent staged slots; install @portalshq/capability-queue-broadcast@^0.1.5",
      );
    }
    return client as SlotQueueClient;
  }

  private async waitForStreamerRetry(signal: AbortSignal): Promise<void> {
    const retryAt = this.streamer.retryAt ?? Date.now() + STREAMER_RETRY_DELAYS_MS.at(-1)!;
    await wait(Math.max(0, retryAt - Date.now()), signal);
  }

  private desiredSettingKey(): string {
    return `broadcast:${this.channelId}:desired-state`;
  }

  private cursorSettingKey(sessionId: number): string {
    return `broadcast:${this.channelId}:session:${sessionId}:cursor`;
  }
}

class TerminalSlotError extends Error {}
class PartialSlotStageError extends Error {
  constructor(readonly imageJobId: string, readonly stageCause: unknown) {
    super("Image staged but narration upload failed");
  }
}
class StreamerUnavailableError extends Error {}
class StreamerProbeError extends Error {}

function safeImageDuration(durationSeconds: number): number {
  // Unified floor: max(config, audio). Short clips hold the image for the
  // full floor; long narration is never truncated. Image-only: applies to
  // `imageDuration` on image uploads exclusively — video uploads must omit
  // `imageDuration` and retain their intrinsic duration.
  const floor = broadcastImageFloor();
  if (!Number.isFinite(durationSeconds)) return floor;
  const clamped = Math.max(1, Math.min(30, Math.ceil(Math.max(floor, durationSeconds))));
  return clamped;
}

function broadcastImageFloor(): number {
  const configured = Number(process.env.BROADCAST_IMAGE_DURATION_SECONDS ?? 12);
  return Number.isFinite(configured) ? Math.max(1, Math.min(30, configured)) : 12;
}

function isRetryable(cause: unknown): boolean {
  if (cause instanceof PartialSlotStageError) return isRetryable(cause.stageCause);
  return cause instanceof QueueBroadcastError
    && (cause.status === 0 || cause.status === 429 || cause.status >= 500);
}

function availabilityReason(cause: unknown): string {
  if (cause instanceof StreamerProbeError) return cause.message;
  const status = errorStatus(cause);
  if (status === 0) return "Streamer control API is unreachable";
  if (status === 401 || status === 403) return "Streamer authentication failed";
  if (status) return `Streamer control API returned HTTP ${status}`;

  const message = cause instanceof Error ? cause.message : "";
  if (/econnrefused|enotfound|network|fetch failed|timed out/i.test(message)) {
    return "Streamer control API is unreachable";
  }
  // The status is sent to browser clients, so do not copy a remote response
  // body (which could accidentally contain a secret) into it.
  return "Streamer availability check failed";
}

function errorStatus(cause: unknown): number | undefined {
  if (cause instanceof QueueBroadcastError) return cause.status;
  if (typeof cause !== "object" || cause === null || !("status" in cause)) return undefined;
  const value = cause.status;
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    timer.unref?.();
  });
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (result) => {
        signal.removeEventListener("abort", abort);
        resolve(result);
      },
      (cause) => {
        signal.removeEventListener("abort", abort);
        reject(cause);
      },
    );
  });
}

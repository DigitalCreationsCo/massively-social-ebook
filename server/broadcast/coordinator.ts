import crypto from "node:crypto";

import {
  QueueBroadcastClient,
  QueueBroadcastError,
  type QueueBroadcastJob,
} from "@portalshq/capability-queue-broadcast";
import type { ActivationResult, TickResult } from "@portalshq/runtime-core";
import type { Session } from "@shared/schema";

import { logger } from "../logger";
import { storage } from "../storage";
import {
  hydrateCanonicalPair,
  pairsFromBlock,
  prepareAmbientPair,
  prepareCanonicalBlock,
  type PreparedBroadcastPair,
} from "./media";

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
  currentJobs?: { imageJobId: string; audioJobId: string };
  lastError?: string;
  streamer: StreamerAvailabilityStatus;
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
  private currentJobs: BroadcastCoordinatorStatus["currentJobs"];
  private lastError: string | undefined;
  private streamer: StreamerAvailabilityStatus = { state: "unknown" };
  private streamerFailureCount = 0;

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
    await storage.setSystemSetting(this.desiredSettingKey(), "stopped");
    this.abortController?.abort(new Error("Broadcast stopped by operator"));
    await this.producerPromise?.catch(() => undefined);
    this.abortController = undefined;
    this.producerPromise = undefined;
    this.currentJobs = undefined;
  }

  async restart(trigger: "operator" | "schedule" = "operator"): Promise<void> {
    this.abortController?.abort(new Error(`Broadcast restarted by ${trigger}`));
    await this.producerPromise?.catch(() => undefined);
    this.hasStoredDesiredState = true;
    this.desiredState = "running";
    this.runId = crypto.randomUUID();
    this.ambientSequence = 0;
    this.lastError = undefined;
    this.streamer = { state: "unknown" };
    this.streamerFailureCount = 0;
    await storage.setSystemSetting(this.desiredSettingKey(), "running");
    this.startProducer();
  }

  /** Stop local work for process shutdown without changing the persisted desired state. */
  async shutdown(): Promise<void> {
    this.abortController?.abort(new Error("Broadcast process shutting down"));
    await this.producerPromise?.catch(() => undefined);
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
    };
  }

  private startProducer(): void {
    if (this.producerPromise || this.desiredState !== "running") return;
    this.runId ??= crypto.randomUUID();
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
          await this.produceEpisode(session, signal);
          continue;
        }

        if (preRollDue && scheduled) {
          this.mode = "preparing";
          this.sessionStatus = "preparing";
          await this.ensureStagedPairs(scheduled, 2, signal);
        }

        this.mode = "ambient";
        this.sessionStatus = scheduled ? "scheduled" : "none";
        const lastCanonical = await storage.getLastBlock(this.channelId);
        const sequence = this.ambientSequence++;
        await this.requireStreamerAvailable(signal);
        const pairs = await prepareAmbientPair(
          this.channelId,
          lastCanonical?.content ?? "",
          this.runId!,
          sequence,
          signal,
        );
        for (const pair of pairs) {
          signal.throwIfAborted();
          const next = await storage.getNextSession(this.channelId);
          if (next && Date.now() >= next.scheduledStart.getTime()) break;
          await this.submitPair(pair, signal);
        }
        this.lastError = undefined;
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

  private async produceEpisode(session: Session, signal: AbortSignal): Promise<void> {
    this.mode = "preparing";
    this.sessionStatus = session.status === "active" ? "active" : "preparing";
    const cursorKey = this.cursorSettingKey(session.id);
    const cursor = Number(await storage.getSystemSetting(cursorKey) || 0);
    await this.ensureStagedPairs(session, cursor + 2, signal);
    if (Date.now() >= session.scheduledEnd.getTime()) {
      await this.finishSession(session);
      return;
    }

    const blocks = await storage.getBlocksBySessionOrdered(session.id);
    const pairs = blocks.flatMap((block) => block.deliverySegments?.length ? pairsFromBlock(block) : []);
    const pair = pairs[cursor];
    if (!pair) return;

    let markedActive = session.status === "active";
    try {
      await this.submitPair(pair, signal, async () => {
        if (!markedActive) {
          await storage.updateSessionStatus(session.id, "active");
          markedActive = true;
        }
        this.mode = "episode";
        this.sessionStatus = "active";
        this.activeSessionId = session.id;
      });
    } catch (cause) {
      if (!(cause instanceof TerminalPairError)) throw cause;
      logger.error(
        `Skipping terminal canonical pair ${pair.idempotencyPrefix}`,
        "broadcast",
        cause,
      );
    }
    await storage.setSystemSetting(cursorKey, String(cursor + 1));
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
      return false;
    }
  }

  private async ensureStagedPairs(session: Session, minimumPairs: number, signal: AbortSignal): Promise<void> {
    await this.requireStreamerAvailable(signal);
    let blocks = await storage.getBlocksBySessionOrdered(session.id);
    // Recover any canonical archive that was persisted before an interrupted
    // process could store its remote staged-pair receipt.
    for (const block of blocks) {
      for (const pair of pairsFromBlock(block)) {
        if (!pair.queuePairId) await this.stageCanonicalPair(block, pair, signal);
      }
    }
    blocks = await storage.getBlocksBySessionOrdered(session.id);
    let pairCount = blocks.reduce(
      (count, block) => count + (block.deliverySegments?.length ?? 0),
      0,
    );
    while (pairCount < minimumPairs && Date.now() < session.scheduledEnd.getTime()) {
      signal.throwIfAborted();
      const previousContext = blocks.at(-1)?.content
        ?? (await storage.getLastBlock(this.channelId))?.content
        ?? "";
      await this.requireStreamerAvailable(signal);
      const prepared = await prepareCanonicalBlock(this.channelId, session, previousContext, signal);
      for (const pair of prepared.pairs) {
        await this.stageCanonicalPair(prepared.block, pair, signal);
      }
      blocks = [...blocks, prepared.block];
      pairCount += prepared.pairs.length;
    }
  }

  private async stageCanonicalPair(
    block: Awaited<ReturnType<typeof storage.getBlocksBySessionOrdered>>[number],
    pair: PreparedBroadcastPair,
    signal: AbortSignal,
  ): Promise<void> {
    // This protects both archive hydration and the direct multipart upload.
    await this.requireStreamerAvailable(signal);
    const upload = pair.image && pair.audio ? pair : await hydrateCanonicalPair(block, pair, signal);
    if (!upload.image || !upload.audio) throw new Error("Canonical pair has no media bytes to stage");
    const staged = await this.client.stagePair({
      image: upload.image,
      audio: upload.audio,
      imageDuration: safeImageDuration(upload.durationSeconds),
      idempotencyKey: upload.idempotencyPrefix,
    });
    const existing = block.deliverySegments ?? [];
    const nextSegments = existing.map((segment) => segment.ordinal === pair.segmentOrdinal
      ? {
          ...segment,
          queuePairId: staged.pair_id,
          queueIdempotencyKey: upload.idempotencyPrefix,
        }
      : segment);
    await storage.updateBlock(block.id, { deliverySegments: nextSegments });
  }

  private async finishSession(session: Session): Promise<void> {
    if (session.status !== "completed") await storage.updateSessionStatus(session.id, "completed");
    this.activeSessionId = undefined;
    this.sessionStatus = "completed";
    this.mode = "ambient";
  }

  private async submitPair(
    pair: PreparedBroadcastPair,
    signal: AbortSignal,
    onSubmitted?: () => Promise<void>,
  ): Promise<void> {
    if (!pair.queuePairId) await this.requireStreamerAvailable(signal);
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      signal.throwIfAborted();
      try {
        const queued = pair.queuePairId
          ? await this.client.releasePair(pair.queuePairId, { signal })
          : await this.enqueueDirectPair(pair, signal);
        const imageJob = queued.image;
        const audioJob = queued.audio;
        this.currentJobs = { imageJobId: imageJob.id, audioJobId: audioJob.id };
        await onSubmitted?.();
        const [finalImage, finalAudio] = await Promise.all([
          this.waitForJob(imageJob.id, signal),
          this.waitForJob(audioJob.id, signal),
        ]);
        if (finalImage.status === "failed" || finalAudio.status === "failed") {
          throw new TerminalPairError(
            `Queue pair failed: image=${finalImage.status}, audio=${finalAudio.status}`,
          );
        }
        this.currentJobs = undefined;
        return;
      } catch (cause) {
        this.currentJobs = undefined;
        if (cause instanceof TerminalPairError || !isRetryable(cause) || attempt === RETRY_DELAYS_MS.length) {
          throw cause;
        }
        lastError = cause;
        await wait(RETRY_DELAYS_MS[attempt], signal);
      }
    }
    throw lastError;
  }

  private async waitForJob(jobId: string, signal: AbortSignal): Promise<QueueBroadcastJob> {
    let final: QueueBroadcastJob | undefined;
    for await (const job of this.client.watchJob(jobId, { signal, intervalMs: 1_000 })) final = job;
    if (!final) signal.throwIfAborted();
    if (!final) throw new Error(`Queue job ${jobId} ended without a terminal state`);
    return final;
  }

  private async enqueueDirectPair(
    pair: PreparedBroadcastPair,
    signal: AbortSignal,
  ): Promise<{ image: QueueBroadcastJob; audio: QueueBroadcastJob }> {
    if (!pair.image || !pair.audio) {
      throw new Error(`Pair ${pair.idempotencyPrefix} is missing completed media bytes`);
    }
    signal.throwIfAborted();
    return this.client.enqueuePairUpload({
      image: pair.image,
      audio: pair.audio,
      imageDuration: safeImageDuration(pair.durationSeconds),
      idempotencyKey: pair.idempotencyPrefix,
    });
  }

  private async requireStreamerAvailable(signal: AbortSignal): Promise<void> {
    if (!await this.ensureStreamerAvailable(signal)) throw new StreamerUnavailableError();
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

class TerminalPairError extends Error {}
class StreamerUnavailableError extends Error {}
class StreamerProbeError extends Error {}

function safeImageDuration(durationSeconds: number): number {
  return Math.max(1, Math.min(30, Math.ceil(durationSeconds)));
}

function isRetryable(cause: unknown): boolean {
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

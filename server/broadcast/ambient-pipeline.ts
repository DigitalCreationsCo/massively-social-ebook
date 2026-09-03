import type { QueueBroadcastJob } from "@portalshq/capability-queue-broadcast";

import type { PreparedAmbientTurn } from "./media-slots";

export interface AmbientTurnMetrics {
  sequence: number;
  generationStartedAt?: number;
  generationEndedAt?: number;
  stagingStartedAt?: number;
  stagingEndedAt?: number;
  releasedAt?: number;
  monitoringEndedAt?: number;
  generationMs?: number;
  stagingMs?: number;
  pipelineMs?: number;
  jobStateTransitions: Array<{ timestamp: number; jobId: string; from?: string; to: string }>;
}

export interface AmbientPipelineStatus {
  inFlightGeneration: number;
  preparedBytes: number;
  readySeconds: number;
  stagedTurns: number;
  releasedTurns: number;
  nextReleaseSequence: number;
}

interface AmbientPipelineOptions {
  initialSequence: number;
  generateTurn: (sequence: number, signal: AbortSignal) => Promise<PreparedAmbientTurn | undefined>;
  stageTurn: (turn: PreparedAmbientTurn, signal: AbortSignal) => Promise<void>;
  releaseTurn: (turn: PreparedAmbientTurn, signal: AbortSignal) => Promise<QueueBroadcastJob[]>;
  monitorJobs: (
    jobs: QueueBroadcastJob[],
    signal: AbortSignal,
    onJobUpdate: (job: QueueBroadcastJob) => void,
  ) => Promise<void>;
  onError: (cause: unknown, phase: "generation" | "staging" | "release" | "monitoring", sequence: number) => void;
  onActiveJobsChanged: (jobIds: string[]) => void;
  onMetrics: (metrics: AmbientTurnMetrics) => void;
  maxReadySeconds?: number;
  maxPreparedBytes?: number;
  maxInFlightGeneration?: number;
  safetyMarginMs?: number;
}

export type AmbientReleaseResult =
  | { state: "released"; sequence: number; jobIds: string[] }
  | { state: "pending" }
  | { state: "blocked"; episodeStart: number };

const DEFAULT_MAX_READY_SECONDS = 30;
const DEFAULT_MAX_PREPARED_BYTES = 50 * 1024 * 1024;
// Keep the default deliberately conservative: several hosted AI providers
// reject overlapping structured-output requests. Operators can raise this
// after verifying their provider quota supports it.
const DEFAULT_MAX_IN_FLIGHT_GENERATION = 1;
const DEFAULT_SAFETY_MARGIN_MS = 2_000;
const ESTIMATED_TURN_SECONDS = 15;

/**
 * Generates ambient turns ahead of playout, stages them remotely, and only
 * releases FIFO work when doing so cannot delay the next scheduled episode.
 * The class owns all background promises so a coordinator can abort and join
 * them during stop, restart, and mode changes.
 */
export class AmbientPipeline {
  private readonly generatedTurns = new Map<number, PreparedAmbientTurn>();
  private readonly stagedTurns = new Map<number, PreparedAmbientTurn>();
  private readonly releasedTurns = new Map<number, { durationSeconds: number; jobIds: string[] }>();
  private readonly skippedSequences = new Set<number>();
  private readonly inFlightGeneration = new Set<number>();
  private readonly metrics = new Map<number, AmbientTurnMetrics>();
  private readonly monitorPromises = new Set<Promise<void>>();
  private readonly maxReadySeconds: number;
  private readonly maxPreparedBytes: number;
  private readonly maxInFlightGeneration: number;
  private readonly safetyMarginMs: number;
  private controller: AbortController | undefined;
  private refillPromise: Promise<void> | undefined;
  private nextGenerationSequence: number;
  private nextStageSequence: number;
  private nextReleaseSequence: number;
  private preparedBytes = 0;
  private nextGenerationAt = 0;
  private revision = 0;
  private waiters = new Set<() => void>();

  constructor(private readonly options: AmbientPipelineOptions) {
    this.maxReadySeconds = boundedEnvironmentNumber(
      "BROADCAST_AMBIENT_READY_SECONDS",
      options.maxReadySeconds ?? DEFAULT_MAX_READY_SECONDS,
      1,
      300,
    );
    this.maxPreparedBytes = boundedEnvironmentNumber(
      "BROADCAST_AMBIENT_MAX_PREPARED_BYTES",
      options.maxPreparedBytes ?? DEFAULT_MAX_PREPARED_BYTES,
      1_024,
      512 * 1024 * 1024,
    );
    this.maxInFlightGeneration = boundedEnvironmentNumber(
      "BROADCAST_AMBIENT_MAX_IN_FLIGHT_GENERATIONS",
      options.maxInFlightGeneration ?? DEFAULT_MAX_IN_FLIGHT_GENERATION,
      1,
      4,
    );
    this.safetyMarginMs = boundedEnvironmentNumber(
      "BROADCAST_AMBIENT_SAFETY_MARGIN_MS",
      options.safetyMarginMs ?? DEFAULT_SAFETY_MARGIN_MS,
      0,
      30_000,
    );
    this.nextGenerationSequence = options.initialSequence;
    this.nextStageSequence = options.initialSequence;
    this.nextReleaseSequence = options.initialSequence;
  }

  getStatus(): AmbientPipelineStatus {
    return {
      inFlightGeneration: this.inFlightGeneration.size,
      preparedBytes: this.preparedBytes,
      readySeconds: this.readySeconds(),
      stagedTurns: this.stagedTurns.size,
      releasedTurns: this.releasedTurns.size,
      nextReleaseSequence: this.nextReleaseSequence,
    };
  }

  start(signal: AbortSignal): void {
    if (this.refillPromise) return;
    const controller = new AbortController();
    this.controller = controller;
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    this.refillPromise = this.refill(controller.signal)
      .finally(() => signal.removeEventListener("abort", abort));
  }

  async releaseNextSafe(nextEpisodeStart: number | null, signal: AbortSignal): Promise<AmbientReleaseResult> {
    signal.throwIfAborted();
    const turn = this.stagedTurns.get(this.nextReleaseSequence);
    if (!turn) return { state: "pending" };
    if (!this.canReleaseTurn(Date.now(), nextEpisodeStart)) {
      return { state: "blocked", episodeStart: nextEpisodeStart! };
    }

    const metrics = this.metricsFor(turn.sequence);
    try {
      const jobs = await this.options.releaseTurn(turn, this.workerSignal());
      if (jobs.length === 0) throw new Error("Streamer released an empty ambient turn");
      metrics.releasedAt = Date.now();
      this.stagedTurns.delete(turn.sequence);
      this.preparedBytes -= turn.totalBytes;
      this.releasedTurns.set(turn.sequence, {
        durationSeconds: turn.totalDurationSeconds,
        jobIds: jobs.map((job) => job.id),
      });
      this.nextReleaseSequence += 1;
      this.publishMetrics(metrics);
      this.notify();
      this.startMonitoring(turn.sequence, jobs, metrics);
      this.publishActiveJobs();
      return { state: "released", sequence: turn.sequence, jobIds: jobs.map((job) => job.id) };
    } catch (cause) {
      this.options.onError(cause, "release", turn.sequence);
      throw cause;
    }
  }

  async waitForProgress(afterRevision: number, signal: AbortSignal): Promise<void> {
    if (this.revision !== afterRevision) return;
    if (signal.aborted) throw signal.reason;
    await new Promise<void>((resolve, reject) => {
      const wake = () => {
        cleanup();
        resolve();
      };
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      const cleanup = () => {
        this.waiters.delete(wake);
        signal.removeEventListener("abort", abort);
      };
      this.waiters.add(wake);
      signal.addEventListener("abort", abort, { once: true });
      if (this.revision !== afterRevision) wake();
    });
  }

  currentRevision(): number {
    return this.revision;
  }

  async abortAndAwaitAll(reason = new Error("Ambient pipeline stopped")): Promise<void> {
    this.controller?.abort(reason);
    this.notify();
    await this.refillPromise?.catch(() => undefined);
    await Promise.allSettled([...this.monitorPromises]);
    this.controller = undefined;
    this.refillPromise = undefined;
  }

  private async refill(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.stageGeneratedTurns(signal);
      let launched = false;
      while (
        !signal.aborted
        && Date.now() >= this.nextGenerationAt
        && this.inFlightGeneration.size < this.maxInFlightGeneration
        && this.hasGenerationCapacity()
      ) {
        this.launchGeneration(this.nextGenerationSequence++, signal);
        launched = true;
      }
      if (launched) continue;
      const revision = this.revision;
      const progress = this.waitForProgress(revision, signal);
      const cooldown = this.nextGenerationAt > Date.now()
        ? wait(this.nextGenerationAt - Date.now(), signal)
        : undefined;
      await (cooldown ? Promise.race([progress, cooldown]) : progress).catch((cause) => {
        if (!signal.aborted) throw cause;
      });
    }
  }

  private launchGeneration(sequence: number, signal: AbortSignal): void {
    this.inFlightGeneration.add(sequence);
    const metrics = this.metricsFor(sequence);
    metrics.generationStartedAt = Date.now();
    void this.options.generateTurn(sequence, signal)
      .then((turn) => {
        metrics.generationEndedAt = Date.now();
        metrics.generationMs = metrics.generationEndedAt - metrics.generationStartedAt!;
        if (!turn) {
          this.skippedSequences.add(sequence);
          this.nextGenerationAt = Date.now() + 2_000;
          this.publishMetrics(metrics);
          return;
        }
        if (!this.hasPreparedCapacity(turn)) {
          this.skippedSequences.add(sequence);
          this.options.onError(
            new Error(`Ambient turn ${sequence} exceeded configured pipeline bounds`),
            "generation",
            sequence,
          );
          this.publishMetrics(metrics);
          return;
        }
        this.generatedTurns.set(sequence, turn);
        this.preparedBytes += turn.totalBytes;
        this.publishMetrics(metrics);
      })
      .catch((cause) => {
        if (!signal.aborted) this.options.onError(cause, "generation", sequence);
        this.skippedSequences.add(sequence);
        this.nextGenerationAt = Date.now() + 2_000;
      })
      .finally(() => {
        this.inFlightGeneration.delete(sequence);
        this.notify();
      });
  }

  private async stageGeneratedTurns(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      if (this.skippedSequences.delete(this.nextStageSequence)) {
        this.nextStageSequence += 1;
        if (this.nextReleaseSequence < this.nextStageSequence && !this.stagedTurns.has(this.nextReleaseSequence)) {
          this.nextReleaseSequence += 1;
        }
        this.notify();
        continue;
      }
      const turn = this.generatedTurns.get(this.nextStageSequence);
      if (!turn) return;
      const metrics = this.metricsFor(turn.sequence);
      metrics.stagingStartedAt = Date.now();
      try {
        await this.options.stageTurn(turn, signal);
        metrics.stagingEndedAt = Date.now();
        metrics.stagingMs = metrics.stagingEndedAt - metrics.stagingStartedAt;
        this.generatedTurns.delete(turn.sequence);
        this.stagedTurns.set(turn.sequence, turn);
        this.nextStageSequence += 1;
        this.publishMetrics(metrics);
        this.notify();
      } catch (cause) {
        if (!signal.aborted) this.options.onError(cause, "staging", turn.sequence);
        this.generatedTurns.delete(turn.sequence);
        this.preparedBytes -= turn.totalBytes;
        this.skippedSequences.add(turn.sequence);
        this.notify();
        return;
      }
    }
  }

  private startMonitoring(sequence: number, jobs: QueueBroadcastJob[], metrics: AmbientTurnMetrics): void {
    const jobStates = new Map<string, string>();
    const recordJobUpdate = (job: QueueBroadcastJob) => {
      const previous = jobStates.get(job.id);
      if (previous === job.status) return;
      jobStates.set(job.id, job.status);
      metrics.jobStateTransitions.push({
        timestamp: Date.now(),
        jobId: job.id,
        ...(previous ? { from: previous } : {}),
        to: job.status,
      });
    };
    jobs.forEach(recordJobUpdate);
    const monitor = this.options.monitorJobs(jobs, this.workerSignal(), recordJobUpdate)
      .catch((cause) => {
        if (!this.workerSignal().aborted) this.options.onError(cause, "monitoring", sequence);
      })
      .finally(() => {
        metrics.monitoringEndedAt = Date.now();
        if (metrics.generationStartedAt) metrics.pipelineMs = metrics.monitoringEndedAt - metrics.generationStartedAt;
        this.releasedTurns.delete(sequence);
        this.publishMetrics(metrics);
        this.metrics.delete(sequence);
        this.publishActiveJobs();
        this.notify();
        this.monitorPromises.delete(monitor);
      });
    this.monitorPromises.add(monitor);
  }

  private canReleaseTurn(now: number, nextEpisodeStart: number | null): boolean {
    if (nextEpisodeStart === null) return true;
    // `turn` is already part of stagedTurns. Count all staged work so a
    // sequence-ordered release cannot make an episode late after this call.
    const reservedMs = (this.releasedDurationSeconds() + this.stagedDurationSeconds()) * 1_000;
    return now + reservedMs + this.safetyMarginMs < nextEpisodeStart;
  }

  private hasGenerationCapacity(): boolean {
    const reservedSeconds = this.readySeconds() + this.inFlightGeneration.size * ESTIMATED_TURN_SECONDS;
    return reservedSeconds < this.maxReadySeconds && this.preparedBytes < this.maxPreparedBytes;
  }

  private hasPreparedCapacity(turn: PreparedAmbientTurn): boolean {
    return this.readySeconds() + turn.totalDurationSeconds <= this.maxReadySeconds
      && this.preparedBytes + turn.totalBytes <= this.maxPreparedBytes;
  }

  private readySeconds(): number {
    return this.releasedDurationSeconds() + this.stagedDurationSeconds()
      + [...this.generatedTurns.values()].reduce((total, turn) => total + turn.totalDurationSeconds, 0);
  }

  private releasedDurationSeconds(): number {
    return [...this.releasedTurns.values()].reduce((total, turn) => total + turn.durationSeconds, 0);
  }

  private stagedDurationSeconds(): number {
    return [...this.stagedTurns.values()].reduce((total, turn) => total + turn.totalDurationSeconds, 0);
  }

  private workerSignal(): AbortSignal {
    if (!this.controller) throw new Error("Ambient pipeline has not started");
    return this.controller.signal;
  }

  private metricsFor(sequence: number): AmbientTurnMetrics {
    let metrics = this.metrics.get(sequence);
    if (!metrics) {
      if (this.metrics.size >= 100) this.metrics.delete(this.metrics.keys().next().value!);
      metrics = { sequence, jobStateTransitions: [] };
      this.metrics.set(sequence, metrics);
    }
    return metrics;
  }

  private publishMetrics(metrics: AmbientTurnMetrics): void {
    this.options.onMetrics({ ...metrics });
  }

  private publishActiveJobs(): void {
    this.options.onActiveJobsChanged([...this.releasedTurns.values()].flatMap((turn) => turn.jobIds));
  }

  private notify(): void {
    this.revision += 1;
    for (const wake of this.waiters) wake();
    this.waiters.clear();
  }
}

function boundedEnvironmentNumber(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    timer.unref?.();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

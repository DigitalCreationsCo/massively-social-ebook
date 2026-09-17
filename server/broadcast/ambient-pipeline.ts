import type { QueueBroadcastJob } from "@portalshq/capability-queue-broadcast";
import {
  BufferedProgrammingPipeline,
  type ProgrammingPipelineMetrics,
  type ProgrammingPipelineStatus,
} from "@portalshq/capability-video-delivery";

import type { PreparedAmbientTurn } from "./media-slots";

export type AmbientTurnMetrics = ProgrammingPipelineMetrics;
export type AmbientPipelineStatus = ProgrammingPipelineStatus;

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
  maxBufferedSlots?: number;
}

/** App-specific configuration and callbacks for Portals' reusable programming pipeline. */
export class AmbientPipeline extends BufferedProgrammingPipeline<PreparedAmbientTurn, QueueBroadcastJob> {
  constructor(options: AmbientPipelineOptions) {
    super({
      ...options,
      maxReadySeconds: configuredNumber("BROADCAST_AMBIENT_READY_SECONDS", options.maxReadySeconds, 1, 300),
      maxPreparedBytes: configuredNumber("BROADCAST_AMBIENT_MAX_PREPARED_BYTES", options.maxPreparedBytes, 1_024, 512 * 1024 * 1024),
      maxInFlightGeneration: configuredNumber("BROADCAST_AMBIENT_MAX_IN_FLIGHT_GENERATIONS", options.maxInFlightGeneration, 1, 4),
      safetyMarginMs: configuredNumber("BROADCAST_AMBIENT_SAFETY_MARGIN_MS", options.safetyMarginMs, 0, 30_000),
      maxBufferedSlots: configuredNumber("BROADCAST_AMBIENT_BUFFER_SLOTS", options.maxBufferedSlots, 1, 5),
    });
  }
}

function configuredNumber(
  name: string,
  explicit: number | undefined,
  minimum: number,
  maximum: number,
): number | undefined {
  const raw = process.env[name];
  if (explicit === undefined && !raw?.trim()) return undefined;
  const value = explicit ?? Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

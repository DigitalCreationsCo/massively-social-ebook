import { QueueBroadcastError } from "@portalshq/capability-queue-broadcast";

export const RETRY_DELAYS_MS = [500, 1_500, 4_000] as const;
export const STREAMER_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000] as const;

export class PartialSlotStageError extends Error {
  constructor(readonly imageJobId: string, readonly stageCause: unknown) {
    super("Image staged but narration upload failed");
  }
}
export class TerminalSlotError extends Error {}
export class StreamerUnavailableError extends Error {}
export class StreamerProbeError extends Error {}

export function isRetryable(cause: unknown): boolean {
  if (cause instanceof PartialSlotStageError) return isRetryable(cause.stageCause);
  return (
    cause instanceof QueueBroadcastError &&
    (cause.status === 0 || cause.status === 429 || cause.status >= 500)
  );
}

export function errorStatus(cause: unknown): number | undefined {
  if (cause instanceof QueueBroadcastError) return cause.status;
  if (typeof cause !== "object" || cause === null || !("status" in cause)) return undefined;
  const value = (cause as { status: unknown }).status;
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export function availabilityReason(cause: unknown): string {
  if (cause instanceof StreamerProbeError) return cause.message;
  const status = errorStatus(cause);
  if (status === 0) return "Streamer control API is unreachable";
  if (status === 401 || status === 403) return "Streamer authentication failed";
  if (status) return `Streamer control API returned HTTP ${status}`;
  const message = cause instanceof Error ? cause.message : "";
  if (/econnrefused|enotfound|network|fetch failed|timed out/i.test(message)) {
    return "Streamer control API is unreachable";
  }
  return "Streamer availability check failed";
}

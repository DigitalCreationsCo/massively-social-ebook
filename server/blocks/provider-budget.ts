/**
 * Process-local admission control for paid generation providers.
 *
 * This is deliberately an admission gate, not a retry mechanism: after a
 * provider says quota/rate-limit, callers must use their ordinary archive
 * fallback instead of keeping a prepared-slot refill blocked behind retries.
 */
export interface ProviderBudgetStatus {
  healthy: boolean;
  retryAt?: number;
  nextImageStartAt?: number;
  queued: number;
  active: number;
  batchQueued: number;
  batchActive: number;
}

const IMAGE_CONCURRENCY = 1;
const COOLDOWN_MS = 90_000;
/** Deliberate provider budget: no more than one image start per 15 seconds. */
const IMAGE_START_INTERVAL_MS = 15_000;
/**
 * Batch lane for multi-image fan-out (OpenRouter Images API): paced parallelism
 * instead of the strict single lane above. Env-tunable without a code change.
 */
function batchImageConcurrency(): number {
  const raw = Number.parseInt(process.env.IMAGE_BATCH_CONCURRENCY ?? "4", 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 8) : 4;
}
function batchImageStartIntervalMs(): number {
  const raw = Number.parseInt(process.env.IMAGE_BATCH_INTERVAL_MS ?? "1000", 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1000;
}
let active = 0;
let cooldownUntil = 0;
let nextImageStartAt = 0;
const waiting: Array<() => void> = [];
let batchActive = 0;
let batchNextStartAt = 0;
const batchWaiting: Array<() => void> = [];

export class ProviderBudgetUnavailableError extends Error {
  constructor(readonly retryAt: number) {
    super(`Image provider budget is cooling down until ${new Date(retryAt).toISOString()}`);
    this.name = "ProviderBudgetUnavailableError";
  }
}

export function getImageProviderBudgetStatus(now = Date.now()): ProviderBudgetStatus {
  return {
    healthy: now >= cooldownUntil,
    ...(now < cooldownUntil ? { retryAt: cooldownUntil } : {}),
    ...(Math.max(nextImageStartAt, batchNextStartAt) > now ? { nextImageStartAt: Math.max(nextImageStartAt, batchNextStartAt) } : {}),
    queued: waiting.length,
    active,
    batchQueued: batchWaiting.length,
    batchActive,
  };
}

export async function admitImageProviderWork<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (Date.now() < cooldownUntil) throw new ProviderBudgetUnavailableError(cooldownUntil);
  await acquire(signal);
  try {
    signal?.throwIfAborted();
    if (Date.now() < cooldownUntil) throw new ProviderBudgetUnavailableError(cooldownUntil);
    await waitUntil(nextImageStartAt, signal);
    signal?.throwIfAborted();
    if (Date.now() < cooldownUntil) throw new ProviderBudgetUnavailableError(cooldownUntil);
    nextImageStartAt = Date.now() + IMAGE_START_INTERVAL_MS;
    return await operation();
  } catch (cause) {
    if (isBudgetFailure(cause)) cooldownUntil = Date.now() + COOLDOWN_MS;
    throw cause;
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

async function waitUntil(when: number, signal?: AbortSignal): Promise<void> {
  const delay = when - Date.now();
  if (delay <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, delay);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Image provider admission aborted"));
    };
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function acquire(signal?: AbortSignal): Promise<void> {
  if (active < IMAGE_CONCURRENCY) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const wake = () => {
      signal?.removeEventListener("abort", abort);
      active += 1;
      resolve();
    };
    const abort = () => {
      const index = waiting.indexOf(wake);
      if (index >= 0) waiting.splice(index, 1);
      reject(signal?.reason ?? new Error("Image provider admission aborted"));
    };
    waiting.push(wake);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Batch lane: paced parallelism for multi-image fan-out (4-8 different prompts).
 * Shares the cooldown with the single lane, so a 429 on either lane cools both.
 * Pacing (concurrency + start interval) is env-tunable: IMAGE_BATCH_CONCURRENCY
 * (default 4, max 8), IMAGE_BATCH_INTERVAL_MS (default 1000).
 */
export async function admitBatchImageWork<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (Date.now() < cooldownUntil) throw new ProviderBudgetUnavailableError(cooldownUntil);
  await acquireBatch(signal);
  try {
    signal?.throwIfAborted();
    if (Date.now() < cooldownUntil) throw new ProviderBudgetUnavailableError(cooldownUntil);
    await waitUntil(batchNextStartAt, signal);
    signal?.throwIfAborted();
    if (Date.now() < cooldownUntil) throw new ProviderBudgetUnavailableError(cooldownUntil);
    batchNextStartAt = Date.now() + batchImageStartIntervalMs();
    return await operation();
  } catch (cause) {
    if (isBudgetFailure(cause)) cooldownUntil = Date.now() + COOLDOWN_MS;
    throw cause;
  } finally {
    batchActive -= 1;
    batchWaiting.shift()?.();
  }
}

async function acquireBatch(signal?: AbortSignal): Promise<void> {
  if (batchActive < batchImageConcurrency()) {
    batchActive += 1;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const wake = () => {
      signal?.removeEventListener("abort", abort);
      batchActive += 1;
      resolve();
    };
    const abort = () => {
      const index = batchWaiting.indexOf(wake);
      if (index >= 0) batchWaiting.splice(index, 1);
      reject(signal?.reason ?? new Error("Image provider admission aborted"));
    };
    batchWaiting.push(wake);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function isBudgetFailure(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /(?:429|quota|resource exhausted|rate.?limit|too many requests)/i.test(message);
}

/** Test-only reset; production state intentionally survives individual calls. */
export function resetImageProviderBudgetForTests(): void {
  active = 0;
  cooldownUntil = 0;
  nextImageStartAt = 0;
  waiting.length = 0;
  batchActive = 0;
  batchNextStartAt = 0;
  batchWaiting.length = 0;
}

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
}

const IMAGE_CONCURRENCY = 1;
const COOLDOWN_MS = 90_000;
/** Deliberate provider budget: no more than one image start per 15 seconds. */
const IMAGE_START_INTERVAL_MS = 15_000;
let active = 0;
let cooldownUntil = 0;
let nextImageStartAt = 0;
const waiting: Array<() => void> = [];

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
    ...(nextImageStartAt > now ? { nextImageStartAt } : {}),
    queued: waiting.length,
    active,
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
}

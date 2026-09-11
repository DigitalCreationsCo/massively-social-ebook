import { afterEach, describe, expect, it, vi } from "vitest";
import {
  admitBatchImageWork,
  admitImageProviderWork,
  getImageProviderBudgetStatus,
  resetImageProviderBudgetForTests,
} from "./provider-budget";

afterEach(resetImageProviderBudgetForTests);

describe("image provider budget admission", () => {
  it("serializes image provider work", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = admitImageProviderWork(async () => { await gate; return "first"; });
    const secondOperation = vi.fn(async () => "second");
    const controller = new AbortController();
    const second = admitImageProviderWork(secondOperation, controller.signal);
    expect(getImageProviderBudgetStatus()).toMatchObject({ active: 1, queued: 1, healthy: true });
    release();
    await expect(first).resolves.toBe("first");
    controller.abort(new Error("test cleanup"));
    await expect(second).rejects.toThrow("test cleanup");
    expect(secondOperation).not.toHaveBeenCalled();
  });

  it("opens a cooldown after a quota failure", async () => {
    await expect(admitImageProviderWork(async () => { throw new Error("429 quota exhausted"); })).rejects.toThrow("quota");
    expect(getImageProviderBudgetStatus()).toMatchObject({ healthy: false });
    await expect(admitImageProviderWork(async () => "never")).rejects.toThrow("cooling down");
  });

  it("publishes the configured 15-second spacing after an image starts", async () => {
    const before = Date.now();
    await admitImageProviderWork(async () => "image");
    const status = getImageProviderBudgetStatus(before);
    expect(status.nextImageStartAt).toBeGreaterThanOrEqual(before + 15_000);
  });
});

describe("batch image budget lane", () => {
  it("runs batch work in parallel up to the configured concurrency", async () => {
    vi.stubEnv("IMAGE_BATCH_CONCURRENCY", "4");
    vi.stubEnv("IMAGE_BATCH_INTERVAL_MS", "0");
    const order: string[] = [];
    await Promise.all([1, 2, 3].map((n) =>
      admitBatchImageWork(async () => {
        order.push(`start-${n}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(`end-${n}`);
        return n;
      }),
    ));
    // All three started before any finished: genuinely parallel.
    expect(order.indexOf("start-3")).toBeLessThan(order.indexOf("end-1"));
    expect(getImageProviderBudgetStatus()).toMatchObject({ batchActive: 0, batchQueued: 0, healthy: true });
    vi.unstubAllEnvs();
  });

  it("shares the quota cooldown with the single lane", async () => {
    await expect(admitBatchImageWork(async () => { throw new Error("429 quota exhausted"); })).rejects.toThrow("quota");
    expect(getImageProviderBudgetStatus()).toMatchObject({ healthy: false });
    await expect(admitImageProviderWork(async () => "never")).rejects.toThrow("cooling down");
    await expect(admitBatchImageWork(async () => "never")).rejects.toThrow("cooling down");
  });
});

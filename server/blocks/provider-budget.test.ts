import { afterEach, describe, expect, it, vi } from "vitest";
import {
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

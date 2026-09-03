import { describe, expect, it, vi } from "vitest";

import { AmbientPipeline } from "./ambient-pipeline";

function turn(sequence: number, durationSeconds = 10) {
  const image = { data: new Blob(["image"]), filename: `image-${sequence}.jpg`, sha256: "a".repeat(64) };
  return {
    sequence,
    idempotencyPrefix: `channel:main:run:test:sequence:${sequence}`,
    image,
    segments: [{ segmentOrdinal: 0, durationSeconds }],
    totalDurationSeconds: durationSeconds,
    totalBytes: image.data.size,
  };
}

function job(id: string) {
  return { id, status: "queued" as const, media_type: "image" as const, updated_at: "now" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

async function flush(turns = 30): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

describe("AmbientPipeline", () => {
  it("stages and releases completed turns in sequence order", async () => {
    const pending = new Map([[0, deferred<ReturnType<typeof turn>>()], [1, deferred<ReturnType<typeof turn>>()]]);
    const staged: number[] = [];
    const released: number[] = [];
    const metrics: Array<{ sequence: number; jobStateTransitions: Array<{ from?: string; to: string }> }> = [];
    const pipeline = new AmbientPipeline({
      initialSequence: 0,
      generateTurn: (sequence) => pending.get(sequence)?.promise ?? Promise.resolve(undefined),
      stageTurn: async (item) => { staged.push(item.sequence); },
      releaseTurn: async (item) => {
        released.push(item.sequence);
        return [job(`image-${item.sequence}`)];
      },
      monitorJobs: async (jobs, _signal, onJobUpdate) => {
        jobs.forEach((item) => onJobUpdate({ ...item, status: "done" }));
      },
      onError: vi.fn(),
      onActiveJobsChanged: vi.fn(),
      onMetrics: (item) => metrics.push(item),
      maxReadySeconds: 20,
      maxInFlightGeneration: 2,
    });
    const controller = new AbortController();
    pipeline.start(controller.signal);
    await flush();

    pending.get(1)!.resolve(turn(1));
    await flush();
    expect(staged).toEqual([]);

    pending.get(0)!.resolve(turn(0));
    await flush();
    expect(staged).toEqual([0, 1]);

    await expect(pipeline.releaseNextSafe(null, controller.signal)).resolves.toMatchObject({ state: "released", sequence: 0 });
    await expect(pipeline.releaseNextSafe(null, controller.signal)).resolves.toMatchObject({ state: "released", sequence: 1 });
    expect(released).toEqual([0, 1]);
    await flush();
    expect(metrics.find((item) => item.sequence === 0 && item.jobStateTransitions.some((transition) => transition.to === "done")))
      .toMatchObject({
        jobStateTransitions: [{ to: "queued" }, { from: "queued", to: "done" }],
      });
    await pipeline.abortAndAwaitAll();
  });

  it("holds ambient work when its reserved FIFO duration would cross an episode start", async () => {
    const pipeline = new AmbientPipeline({
      initialSequence: 0,
      generateTurn: async () => turn(0),
      stageTurn: async () => undefined,
      releaseTurn: async () => [job("image-0")],
      monitorJobs: async () => undefined,
      onError: vi.fn(),
      onActiveJobsChanged: vi.fn(),
      onMetrics: vi.fn(),
      maxReadySeconds: 10,
      maxInFlightGeneration: 1,
      safetyMarginMs: 2_000,
    });
    const controller = new AbortController();
    pipeline.start(controller.signal);
    await flush();

    await expect(pipeline.releaseNextSafe(Date.now() + 11_000, controller.signal)).resolves.toEqual({
      state: "blocked",
      episodeStart: expect.any(Number),
    });
    await pipeline.abortAndAwaitAll();
  });

  it("aborts and joins in-flight generation without leaving a worker behind", async () => {
    const aborted = vi.fn();
    const pipeline = new AmbientPipeline({
      initialSequence: 0,
      generateTurn: (_sequence, signal) => new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          aborted();
          resolve(undefined);
        }, { once: true });
      }),
      stageTurn: async () => undefined,
      releaseTurn: async () => [job("image-0")],
      monitorJobs: async () => undefined,
      onError: vi.fn(),
      onActiveJobsChanged: vi.fn(),
      onMetrics: vi.fn(),
      maxInFlightGeneration: 2,
    });
    const controller = new AbortController();
    pipeline.start(controller.signal);
    await flush();

    await expect(pipeline.abortAndAwaitAll()).resolves.toBeUndefined();
    expect(aborted).toHaveBeenCalledTimes(2);
  });
});

import { describe, expect, it, vi } from "vitest";

import { AmbientPipeline } from "./ambient-pipeline";

function turn(sequence: number, durationSeconds = 10) {
  const image = { data: new Blob(["image"]), filename: `image-${sequence}.jpg`, sha256: "a".repeat(64) };
  return {
    sequence,
    idempotencyPrefix: `channel:main:run:test:sequence:${sequence}`,
    contentId: `channel:main:run:test:sequence:${sequence}`,
    image,
    segments: [{ segmentOrdinal: 0, durationSeconds }],
    totalDurationSeconds: durationSeconds,
    totalBytes: image.data.size,
  };
}

/** Split siblings share one visual identity despite distinct slot sequences. */
function splitSibling(sequence: number, contentId: string, durationSeconds = 10) {
  return { ...turn(sequence, durationSeconds), contentId };
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
      maxBufferedSlots: 1,
    });
    const controller = new AbortController();
    pipeline.start(controller.signal);
    await flush();

    pending.get(1)!.resolve(turn(1));
    await flush();
    expect(staged).toEqual([]);

    pending.get(0)!.resolve(turn(0));
    await flush();
    // With a buffer depth of one, only one remote slot is staged at a time.
    // Later generation can remain in memory, but it must not reserve remote
    // queue capacity early.
    expect(staged).toEqual([0]);

    await expect(pipeline.releaseNextSafe(null, controller.signal)).resolves.toMatchObject({ state: "released", sequence: 0 });
    await flush();
    expect(staged).toEqual([0, 1]);
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

  it("does not release beyond the buffer depth while prior slots are still monitored", async () => {
    const monitoring = deferred<void>();
    const released: number[] = [];
    const pipeline = new AmbientPipeline({
      initialSequence: 0,
      generateTurn: async (sequence) => sequence < 2 ? turn(sequence) : undefined,
      stageTurn: async () => undefined,
      releaseTurn: async (item) => {
        released.push(item.sequence);
        return [job(`image-${item.sequence}`)];
      },
      monitorJobs: async () => monitoring.promise,
      onError: vi.fn(),
      onActiveJobsChanged: vi.fn(),
      onMetrics: vi.fn(),
      maxReadySeconds: 30,
      maxInFlightGeneration: 1,
      maxBufferedSlots: 1,
    });
    const controller = new AbortController();
    pipeline.start(controller.signal);
    await flush();

    await expect(pipeline.releaseNextSafe(null, controller.signal)).resolves.toMatchObject({ state: "released", sequence: 0 });
    await expect(pipeline.releaseNextSafe(null, controller.signal)).resolves.toEqual({ state: "pending" });
    expect(released).toEqual([0]);

    monitoring.resolve();
    await flush();
    await expect(pipeline.releaseNextSafe(null, controller.signal)).resolves.toMatchObject({ state: "released", sequence: 1 });
    expect(released).toEqual([0, 1]);
    await pipeline.abortAndAwaitAll();
  });

  it("releases up to the buffer depth while prior slots are still monitored", async () => {
    const monitoring = deferred<void>();
    const released: number[] = [];
    const pipeline = new AmbientPipeline({
      initialSequence: 0,
      generateTurn: async (sequence) => sequence < 3 ? turn(sequence) : undefined,
      stageTurn: async () => undefined,
      releaseTurn: async (item) => {
        released.push(item.sequence);
        return [job(`image-${item.sequence}`)];
      },
      monitorJobs: async () => monitoring.promise,
      onError: vi.fn(),
      onActiveJobsChanged: vi.fn(),
      onMetrics: vi.fn(),
      maxReadySeconds: 60,
      maxInFlightGeneration: 2,
      maxBufferedSlots: 3,
    });
    const controller = new AbortController();
    pipeline.start(controller.signal);
    await flush();

    // All three images queue immediately when ready — queue time never eats
    // into per-image playback duration. The fourth release pends: buffer full.
    await expect(pipeline.releaseNextSafe(null, controller.signal)).resolves.toMatchObject({ state: "released", sequence: 0 });
    await expect(pipeline.releaseNextSafe(null, controller.signal)).resolves.toMatchObject({ state: "released", sequence: 1 });
    await expect(pipeline.releaseNextSafe(null, controller.signal)).resolves.toMatchObject({ state: "released", sequence: 2 });
    await expect(pipeline.releaseNextSafe(null, controller.signal)).resolves.toEqual({ state: "pending" });
    expect(released).toEqual([0, 1, 2]);

    monitoring.resolve();
    await flush();
    await pipeline.abortAndAwaitAll();
  });

  it("counts split siblings sharing one visual as a single buffered slot", async () => {
    const released: number[] = [];
    const staged: number[] = [];
    const pipeline = new AmbientPipeline({
      initialSequence: 0,
      // Sequences 0-2 share image A (one 3-segment split); 3 is image B.
      // Slot-counting would fill a depth-2 buffer with A0+A1 and starve B.
      generateTurn: async (sequence) => {
        if (sequence === 0 || sequence === 1 || sequence === 2) return splitSibling(sequence, "gen-A");
        if (sequence === 3) return splitSibling(sequence, "gen-B");
        return undefined;
      },
      stageTurn: async (item) => { staged.push(item.sequence); },
      releaseTurn: async (item) => {
        released.push(item.sequence);
        return [job(`image-${item.sequence}`)];
      },
      monitorJobs: async () => undefined,
      onError: vi.fn(),
      onActiveJobsChanged: vi.fn(),
      onMetrics: vi.fn(),
      maxReadySeconds: 60,
      maxInFlightGeneration: 2,
      maxBufferedSlots: 2,
    });
    const controller = new AbortController();
    pipeline.start(controller.signal);
    await flush();

    // All three A slots stage despite depth 2 — they are one distinct visual.
    // B (the next distinct image) stages too instead of starving.
    await expect(pipeline.releaseNextSafe(null, controller.signal)).resolves.toMatchObject({ state: "released", sequence: 0 });
    await expect(pipeline.releaseNextSafe(null, controller.signal)).resolves.toMatchObject({ state: "released", sequence: 1 });
    await expect(pipeline.releaseNextSafe(null, controller.signal)).resolves.toMatchObject({ state: "released", sequence: 2 });
    expect(staged).toEqual(expect.arrayContaining([0, 1, 2]));
    expect(released).toEqual([0, 1, 2]);
    await pipeline.abortAndAwaitAll();
  });

  it("treats a future video turn as one distinct visual like an image turn", async () => {
    const released: number[] = [];
    const pipeline = new AmbientPipeline({
      initialSequence: 0,
      generateTurn: async (sequence) => {
        if (sequence === 0) return turn(0);
        if (sequence === 1) {
          // Video primitive with equal citizenship: own contentId, no imageDuration override.
          return {
            sequence: 1,
            idempotencyPrefix: "channel:main:run:test:sequence:1",
            contentId: "channel:main:run:test:sequence:1",
            image: { data: new Blob(["poster"]), filename: "poster-1.jpg", sha256: "c".repeat(64) },
            video: { data: new Blob(["video"]), filename: "clip-1.mp4", sha256: "d".repeat(64) },
            segments: [{ segmentOrdinal: 0, durationSeconds: 12 }],
            totalDurationSeconds: 12,
            totalBytes: 12,
          };
        }
        return undefined;
      },
      stageTurn: async () => undefined,
      releaseTurn: async (item) => {
        released.push(item.sequence);
        return [job(`image-${item.sequence}`)];
      },
      monitorJobs: async () => undefined,
      onError: vi.fn(),
      onActiveJobsChanged: vi.fn(),
      onMetrics: vi.fn(),
      maxReadySeconds: 60,
      maxInFlightGeneration: 2,
      maxBufferedSlots: 2,
    });
    const controller = new AbortController();
    pipeline.start(controller.signal);
    await flush();

    await expect(pipeline.releaseNextSafe(null, controller.signal)).resolves.toMatchObject({ state: "released", sequence: 0 });
    await expect(pipeline.releaseNextSafe(null, controller.signal)).resolves.toMatchObject({ state: "released", sequence: 1 });
    expect(released).toEqual([0, 1]);
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
    // Up to maxInFlightGeneration workers may be in flight; all must join.
    expect(aborted).toHaveBeenCalledTimes(2);
  });
});

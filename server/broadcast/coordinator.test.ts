import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storageMock = vi.hoisted(() => ({
  getSystemSetting: vi.fn(),
  setSystemSetting: vi.fn(),
  getBlocksBySessionOrdered: vi.fn(),
  updateSessionStatus: vi.fn(),
  getLastBlock: vi.fn(),
  getNextSession: vi.fn(),
  getActiveSession: vi.fn(),
  updateBlock: vi.fn(),
}));

const mediaMock = vi.hoisted(() => ({
  slotsFromBlock: vi.fn(),
  hydrateCanonicalSlot: vi.fn(),
  prepareAmbientSlots: vi.fn(),
  prepareCanonicalSlot: vi.fn(),
  prepareCanonicalText: vi.fn(),
  finishCanonicalSlot: vi.fn(),
}));

const blocksMock = vi.hoisted(() => ({ generateCanonicalStoryWindow: vi.fn() }));

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("./media-slots", () => mediaMock);
vi.mock("../blocks/ai", () => blocksMock);

import { BroadcastCoordinator } from "./coordinator";

const slot = {
  durationSeconds: 12.2,
  idempotencyPrefix: "channel:main:session:3:block:8:segment:0",
  slotKey: "channel:main:session:3:block:8:segment:0:slot",
  segmentOrdinal: 0,
  image: { data: new Blob(["image"]), filename: "image.jpg", sha256: "a".repeat(64) },
  audio: { data: new Blob(["audio"]), filename: "audio.wav", sha256: "b".repeat(64) },
};

function job(id: string, status: "staged" | "queued" | "done" | "failed") {
  return { id, status, media_type: id.startsWith("image") ? "image" : "audio", updated_at: "now" };
}

function ambientTurn(sequence: number) {
  const image = { data: new Blob([`image-${sequence}`]), filename: `image-${sequence}.jpg`, sha256: "a".repeat(64) };
  return {
    sequence,
    idempotencyPrefix: `channel:main:run:test:sequence:${sequence}`,
    contentId: `channel:main:run:test:sequence:${sequence}`,
    image,
    segments: [{ segmentOrdinal: 0, durationSeconds: 12 }],
    totalDurationSeconds: 12,
    totalBytes: image.data.size,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

async function flushMicrotasks(turns = 20): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

describe("BroadcastCoordinator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stages independent assets then releases their deterministic slot", async () => {
    const client = {
      health: vi.fn().mockResolvedValue({ ok: true }),
      getPlayback: vi.fn().mockResolvedValue({ playbackManifestUrl: "http://localhost:8888/live/main/index.m3u8" }),
      stageUpload: vi.fn(async (input: { mediaType: string }) => job(`${input.mediaType}-job`, "staged")),
      releaseSlot: vi.fn(async () => ({ jobs: [job("image-job", "done"), job("audio-job", "done")] })),
      watchJob: vi.fn(async function* (jobId: string) { yield job(jobId, "done"); }),
    };
    const coordinator = new BroadcastCoordinator("main", client as any);

    await (coordinator as any).submitSlot(slot, new AbortController().signal);

    expect(client.stageUpload).toHaveBeenNthCalledWith(1, expect.objectContaining({
      mediaType: "image",
      asset: slot.image,
      imageDuration: 13,
      idempotencyKey: `${slot.idempotencyPrefix}:image`,
      slotKey: slot.slotKey,
    }));
    expect(client.stageUpload).toHaveBeenNthCalledWith(2, expect.objectContaining({
      mediaType: "audio",
      asset: slot.audio,
      idempotencyKey: `${slot.idempotencyPrefix}:audio`,
      slotKey: slot.slotKey,
    }));
    expect(client.releaseSlot).toHaveBeenCalledWith(slot.slotKey, expect.anything());
    expect(client.watchJob).toHaveBeenCalledTimes(2);
  });

  it("buffers ambient slots up to the buffer depth while earlier slots play", async () => {
    storageMock.setSystemSetting.mockResolvedValue(undefined);
    storageMock.getNextSession.mockResolvedValue(undefined);
    storageMock.getActiveSession.mockResolvedValue(undefined);
    storageMock.getLastBlock.mockResolvedValue(undefined);
    mediaMock.prepareAmbientSlots.mockImplementation(async (_channelId: string, _context: string, _runId: string, sequence: number) => ambientTurn(sequence));
    const client = {
      health: vi.fn().mockResolvedValue({ ok: true }),
      getPlayback: vi.fn().mockResolvedValue({ playbackManifestUrl: "http://localhost:8888/live/main/index.m3u8" }),
      stageUpload: vi.fn(async (input: { mediaType: string }) => job(`${input.mediaType}-job`, "staged")),
      releaseSlot: vi.fn(async (slotKey: string) => ({ jobs: [job(`image-${slotKey}`, "queued")] })),
      watchJob: vi.fn(async function* (_jobId: string, options: { signal?: AbortSignal }) {
        yield job("image-playing", "queued");
        await new Promise<void>((resolve) => options.signal?.addEventListener("abort", () => resolve(), { once: true }));
      }),
    };
    const coordinator = new BroadcastCoordinator("main", client as any);

    await coordinator.restart();
    await flushMicrotasks(120);

    // The next images queue immediately when ready — one still playing must
    // not hold back the buffer. Black only appears if the connection breaks.
    expect(client.releaseSlot.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(client.watchJob.mock.calls.length).toBeGreaterThanOrEqual(2);
    await coordinator.stop();
  });

  it("queues split ambient narration segments back-to-back", async () => {
    const firstSegmentFinished = deferred<void>();
    storageMock.setSystemSetting.mockResolvedValue(undefined);
    storageMock.getNextSession.mockResolvedValue(undefined);
    storageMock.getActiveSession.mockResolvedValue(undefined);
    storageMock.getLastBlock.mockResolvedValue(undefined);
    mediaMock.prepareAmbientSlots
      .mockResolvedValueOnce({
        ...ambientTurn(0),
        segments: [
          { segmentOrdinal: 0, durationSeconds: 12 },
          { segmentOrdinal: 1, durationSeconds: 12 },
        ],
        totalDurationSeconds: 24,
      })
      // Keep the test bounded after the two segments under test. Real ambient
      // generation is expensive and therefore cannot resolve in this loop.
      .mockResolvedValue(undefined);
    let monitorCount = 0;
    const client = {
      health: vi.fn().mockResolvedValue({ ok: true }),
      getPlayback: vi.fn().mockResolvedValue({ playbackManifestUrl: "http://localhost:8888/live/main/index.m3u8" }),
      stageUpload: vi.fn(async (input: { mediaType: string }) => job(`${input.mediaType}-job`, "staged")),
      releaseSlot: vi.fn(async (slotKey: string) => ({ jobs: [job(`image-${slotKey}`, "queued")] })),
      watchJob: vi.fn(async function* () {
        monitorCount += 1;
        yield job("image-playing", "queued");
        if (monitorCount === 1) await firstSegmentFinished.promise;
        yield job("image-playing", "done");
      }),
    };
    const coordinator = new BroadcastCoordinator("main", client as any);

    await coordinator.restart();
    await flushMicrotasks(120);
    // Both segments queue immediately when ready — the second never waits for
    // the first duration to complete. The Streamer plays them back-to-back,
    // each for its own duration.
    expect(client.releaseSlot).toHaveBeenCalledTimes(2);
    expect(client.releaseSlot).toHaveBeenNthCalledWith(
      1,
      "channel:main:run:test:sequence:0:segment:0:slot",
      expect.anything(),
    );
    expect(client.releaseSlot).toHaveBeenNthCalledWith(
      2,
      "channel:main:run:test:sequence:0:segment:1:slot",
      expect.anything(),
    );

    firstSegmentFinished.resolve();
    await flushMicrotasks(120);
    await coordinator.stop();
  });

  it("holds a short narration image for the unified floor, never the TTS length", async () => {
    const shortSlot = { ...slot, durationSeconds: 5 };
    const client = {
      health: vi.fn().mockResolvedValue({ ok: true }),
      getPlayback: vi.fn().mockResolvedValue({ playbackManifestUrl: "http://localhost:8888/live/main/index.m3u8" }),
      stageUpload: vi.fn(async (input: { mediaType: string }) => job(`${input.mediaType}-job`, "staged")),
      releaseSlot: vi.fn(async () => ({ jobs: [job("image-job", "done"), job("audio-job", "done")] })),
      watchJob: vi.fn(async function* (jobId: string) { yield job(jobId, "done"); }),
    };
    const coordinator = new BroadcastCoordinator("main", client as any);

    await (coordinator as any).submitSlot(shortSlot, new AbortController().signal);

    // 5s of audio still stages a 12s image; video uploads (when present)
    // never receive imageDuration — equal citizenship, no override.
    expect(client.stageUpload).toHaveBeenNthCalledWith(1, expect.objectContaining({
      mediaType: "image",
      imageDuration: 12,
    }));
    const audioCall = client.stageUpload.mock.calls.find((call) => (call[0] as any).mediaType === "audio");
    expect((audioCall?.[0] as any).imageDuration).toBeUndefined();
  });

  it("preserves split siblings under one visual identity for distinct-image buffering", async () => {
    const coordinator = new BroadcastCoordinator("main", {} as any);
    const sharedImage = { data: new Blob(["image"]), filename: "scene.jpg", sha256: "a".repeat(64) };
    const split = (coordinator as any).splitAmbientTurn({
      sequence: 0,
      idempotencyPrefix: "channel:main:run:test:sequence:0",
      contentId: "channel:main:run:test:sequence:0",
      image: sharedImage,
      segments: [
        { segmentOrdinal: 0, durationSeconds: 12 },
        { segmentOrdinal: 1, durationSeconds: 12 },
      ],
      totalDurationSeconds: 24,
      totalBytes: 10,
    });

    expect(split).toHaveLength(2);
    expect(split[0].contentId).toBe("channel:main:run:test:sequence:0");
    expect(split[1].contentId).toBe("channel:main:run:test:sequence:0");
    expect(split[0].segments).toHaveLength(1);
  });

  it("releases a staged image when its optional audio upload fails", async () => {
    const client = {
      health: vi.fn().mockResolvedValue({ ok: true }),
      getPlayback: vi.fn().mockResolvedValue({ playbackManifestUrl: "http://localhost:8888/live/main/index.m3u8" }),
      stageUpload: vi.fn()
        .mockResolvedValueOnce(job("image-job", "staged"))
        .mockRejectedValueOnce(Object.assign(new Error("invalid audio"), { status: 400 })),
      releaseSlot: vi.fn(async () => ({ jobs: [job("image-job", "done")] })),
      watchJob: vi.fn(async function* () { yield job("image-job", "done"); }),
    };
    const coordinator = new BroadcastCoordinator("main", client as any);

    await (coordinator as any).submitSlot(slot, new AbortController().signal);

    expect(client.releaseSlot).toHaveBeenCalledWith(slot.slotKey, expect.anything());
    expect(client.watchJob).toHaveBeenCalledWith("image-job", expect.anything());
  });

  it("persists a canonical image-only fallback after a terminal audio rejection", async () => {
    const canonicalSlot = { ...slot, imageJobId: undefined, audioJobId: undefined };
    const block = {
      id: 8,
      deliverySegments: [{ ordinal: 0, durationSeconds: 12.2, audioUrl: "https://assets.example/narration.wav" }],
    };
    mediaMock.hydrateCanonicalSlot.mockResolvedValue(canonicalSlot);
    storageMock.updateBlock.mockResolvedValue(undefined);
    const client = {
      health: vi.fn().mockResolvedValue({ ok: true }),
      getPlayback: vi.fn().mockResolvedValue({ playbackManifestUrl: "http://localhost:8888/live/main/index.m3u8" }),
      stageUpload: vi.fn()
        .mockResolvedValueOnce(job("image-job", "staged"))
        .mockResolvedValueOnce(job("audio-job", "failed")),
      releaseSlot: vi.fn(),
    };
    const coordinator = new BroadcastCoordinator("main", client as any);

    await (coordinator as any).stageCanonicalSlot(block, canonicalSlot, new AbortController().signal);

    expect(storageMock.updateBlock).toHaveBeenLastCalledWith(8, {
      deliverySegments: [expect.objectContaining({
        queueImageJobId: "image-job",
        queueAudioUnavailable: true,
      })],
    });
    expect((coordinator as any).slotIsCompletelyStaged(
      { ...block, deliverySegments: [{ ...block.deliverySegments[0], queueImageJobId: "image-job", queueAudioUnavailable: true }] },
      { ...canonicalSlot, imageJobId: "image-job" },
    )).toBe(true);
  });

  it("advances the persisted canonical cursor after a terminal slot failure", async () => {
    const firstSlot = { ...slot, imageJobId: "image-job", audioJobId: "audio-job" };
    const secondSlot = { ...slot, idempotencyPrefix: slot.idempotencyPrefix.replace(/:0$/, ":1"), slotKey: `${slot.slotKey}:next`, segmentOrdinal: 1, imageJobId: "image-job-2", audioJobId: "audio-job-2" };
    // Three staged segments keep ensureStagedSlots (cursor + 3 lookahead)
    // satisfied without invoking generation in this test.
    const block = { id: 8, deliverySegments: [{ audioUrl: "https://assets.example/one.wav" }, { audioUrl: "https://assets.example/two.wav" }, { audioUrl: "https://assets.example/three.wav" }, { audioUrl: "https://assets.example/four.wav" }] };
    storageMock.getSystemSetting.mockResolvedValue("0");
    storageMock.getBlocksBySessionOrdered.mockResolvedValue([block]);
    mediaMock.slotsFromBlock.mockReturnValue([firstSlot, secondSlot]);
    const client = {
      health: vi.fn().mockResolvedValue({ ok: true }),
      getPlayback: vi.fn().mockResolvedValue({ playbackManifestUrl: "http://localhost:8888/live/main/index.m3u8" }),
      stageUpload: vi.fn(),
      releaseSlot: vi.fn(async () => ({ jobs: [job("image-job", "done"), job("audio-job", "done")] })),
      watchJob: vi.fn(async function* (jobId: string) {
        yield job(jobId, jobId.startsWith("image") ? "failed" : "done");
      }),
    };
    const coordinator = new BroadcastCoordinator("main", client as any);
    const session = {
      id: 3,
      status: "active",
      scheduledStart: new Date(),
      scheduledEnd: new Date(Date.now() + 60_000),
    };

    await (coordinator as any).produceEpisode(session, new AbortController().signal);

    expect(storageMock.setSystemSetting).toHaveBeenCalledWith(
      "broadcast:main:session:3:cursor",
      "1",
    );
    expect(client.releaseSlot).toHaveBeenCalledWith(firstSlot.slotKey, expect.anything());
  });

  it("waits for an unavailable Streamer before any media or queue work", async () => {
    const client = {
      health: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:8000")),
      getPlayback: vi.fn(),
      stageUpload: vi.fn(),
      releaseSlot: vi.fn(),
    };
    storageMock.getNextSession.mockResolvedValue(undefined);
    storageMock.getActiveSession.mockResolvedValue(undefined);
    const coordinator = new BroadcastCoordinator("main", client as any);
    (coordinator as any).desiredState = "running";
    const controller = new AbortController();
    const producing = (coordinator as any).produce(controller.signal);

    await flushMicrotasks();
    expect(client.health).toHaveBeenCalledOnce();
    expect(client.getPlayback).not.toHaveBeenCalled();
    expect(mediaMock.prepareAmbientSlots).not.toHaveBeenCalled();
    expect(mediaMock.prepareCanonicalSlot).not.toHaveBeenCalled();
    expect(mediaMock.prepareCanonicalText).not.toHaveBeenCalled();
    expect(mediaMock.finishCanonicalSlot).not.toHaveBeenCalled();
    expect(mediaMock.hydrateCanonicalSlot).not.toHaveBeenCalled();
    expect(client.stageUpload).not.toHaveBeenCalled();
    expect(client.releaseSlot).not.toHaveBeenCalled();
    expect(coordinator.getStatus()).toMatchObject({
      mode: "waiting_for_streamer",
      streamer: {
        state: "unavailable",
        reason: "Streamer control API is unreachable",
      },
    });

    controller.abort(new Error("test complete"));
    await producing;
  });

  it("does not generate when the installed queue client lacks staged-slot support", async () => {
    const client = {
      health: vi.fn().mockResolvedValue({ ok: true }),
      getPlayback: vi.fn().mockResolvedValue({ playbackManifestUrl: "http://localhost:8888/live/main/index.m3u8" }),
    };
    storageMock.getNextSession.mockResolvedValue(undefined);
    storageMock.getActiveSession.mockResolvedValue(undefined);
    const coordinator = new BroadcastCoordinator("main", client as any);
    (coordinator as any).desiredState = "running";
    const controller = new AbortController();
    const producing = (coordinator as any).produce(controller.signal);

    await flushMicrotasks();
    expect(mediaMock.prepareAmbientSlots).not.toHaveBeenCalled();
    expect(coordinator.getStatus()).toMatchObject({
      mode: "waiting_for_streamer",
      streamer: {
        state: "unavailable",
          reason: "Installed queue-broadcast package does not support independent staged slots; install @portalshq/capability-queue-broadcast@^0.1.5",
      },
    });
    controller.abort(new Error("test complete"));
    await producing;
  });

  it("treats unhealthy media and authenticated playback failures as unavailable", async () => {
    const unavailableClient = {
      health: vi.fn().mockResolvedValue({ ok: false }),
      getPlayback: vi.fn(),
    };
    const unavailable = new BroadcastCoordinator("main", unavailableClient as any);

    await expect((unavailable as any).ensureStreamerAvailable(new AbortController().signal)).resolves.toBe(false);
    expect(unavailableClient.getPlayback).not.toHaveBeenCalled();
    expect(unavailable.getStatus()).toMatchObject({
      mode: "waiting_for_streamer",
      streamer: { state: "unavailable", reason: "Streamer reports that its media server is unavailable" },
    });

    const rejectedPlaybackClient = {
      health: vi.fn().mockResolvedValue({ ok: true }),
      getPlayback: vi.fn().mockRejectedValue(Object.assign(new Error("Bearer queue-token-must-not-leak"), { status: 401 })),
    };
    const rejectedPlayback = new BroadcastCoordinator("main", rejectedPlaybackClient as any);

    await expect((rejectedPlayback as any).ensureStreamerAvailable(new AbortController().signal)).resolves.toBe(false);
    expect(rejectedPlaybackClient.health).toHaveBeenCalledOnce();
    expect(rejectedPlaybackClient.getPlayback).toHaveBeenCalledOnce();
    expect(rejectedPlayback.getStatus()).toMatchObject({
      mode: "waiting_for_streamer",
      streamer: { state: "unavailable", reason: "Streamer authentication failed" },
    });
    expect(JSON.stringify(rejectedPlayback.getStatus())).not.toContain("queue-token-must-not-leak");
  });

  it("keeps scheduled episode work preparing without advancing its cursor during an outage", async () => {
    const client = {
      health: vi.fn().mockRejectedValue(new Error("offline")),
      getPlayback: vi.fn(),
      stageUpload: vi.fn(),
    };
    const scheduled = {
      id: 9,
      status: "scheduled",
      scheduledStart: new Date(),
      scheduledEnd: new Date(Date.now() + 60_000),
    };
    storageMock.getNextSession.mockResolvedValue(scheduled);
    storageMock.getActiveSession.mockResolvedValue(undefined);
    const coordinator = new BroadcastCoordinator("main", client as any);
    (coordinator as any).desiredState = "running";
    const controller = new AbortController();
    const producing = (coordinator as any).produce(controller.signal);

    await flushMicrotasks();
    expect(coordinator.getStatus()).toMatchObject({
      desiredState: "running",
      mode: "waiting_for_streamer",
      sessionStatus: "preparing",
    });
    expect(storageMock.getBlocksBySessionOrdered).not.toHaveBeenCalled();
    expect(storageMock.setSystemSetting).not.toHaveBeenCalledWith(
      "broadcast:main:session:9:cursor",
      expect.anything(),
    );
    expect(mediaMock.prepareCanonicalSlot).not.toHaveBeenCalled();
    expect(mediaMock.prepareCanonicalText).not.toHaveBeenCalled();
    expect(mediaMock.finishCanonicalSlot).not.toHaveBeenCalled();
    expect(client.stageUpload).not.toHaveBeenCalled();

    controller.abort(new Error("test complete"));
    await producing;
  });

  it("returns an active episode to preparing when a later preflight fails", async () => {
    const client = {
      health: vi.fn().mockRejectedValue(new Error("offline")),
      getPlayback: vi.fn(),
    };
    const coordinator = new BroadcastCoordinator("main", client as any);
    (coordinator as any).sessionStatus = "active";
    (coordinator as any).activeSessionId = 9;

    await expect((coordinator as any).ensureStreamerAvailable(new AbortController().signal)).resolves.toBe(false);
    expect(coordinator.getStatus()).toMatchObject({
      mode: "waiting_for_streamer",
      sessionStatus: "preparing",
      activeSessionId: 9,
    });
  });

  it("uses capped availability backoff and resets it after both probes recover", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    const client = {
      health: vi.fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockRejectedValueOnce(new Error("offline"))
        .mockRejectedValueOnce(new Error("offline"))
        .mockRejectedValueOnce(new Error("offline"))
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ ok: true }),
      getPlayback: vi.fn().mockResolvedValue({ playbackManifestUrl: "http://localhost:8888/live/main/index.m3u8" }),
      stageUpload: vi.fn(),
      releaseSlot: vi.fn(),
    };
    const coordinator = new BroadcastCoordinator("main", client as any);
    const expectedDelays = [2_000, 5_000, 10_000, 30_000, 30_000];

    for (const delay of expectedDelays) {
      const before = Date.now();
      await expect((coordinator as any).ensureStreamerAvailable(new AbortController().signal)).resolves.toBe(false);
      expect(coordinator.getStatus().streamer.retryAt).toBe(before + delay);
      await vi.advanceTimersByTimeAsync(delay);
    }

    await expect((coordinator as any).ensureStreamerAvailable(new AbortController().signal)).resolves.toBe(true);
    expect(coordinator.getStatus().streamer).toEqual({
      state: "available",
      lastCheckedAt: Date.now(),
      lastSuccessfulAt: Date.now(),
    });
    expect(client.getPlayback).toHaveBeenCalledOnce();
  });

  it("cancels an availability wait on stop and does not resume generation", async () => {
    vi.useFakeTimers();
    const client = {
      health: vi.fn().mockRejectedValue(new Error("offline")),
      getPlayback: vi.fn(),
    };
    storageMock.setSystemSetting.mockResolvedValue(undefined);
    storageMock.getNextSession.mockResolvedValue(undefined);
    storageMock.getActiveSession.mockResolvedValue(undefined);
    const coordinator = new BroadcastCoordinator("main", client as any);

    await coordinator.restart();
    await flushMicrotasks();
    expect(client.health).toHaveBeenCalledOnce();
    await coordinator.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(client.health).toHaveBeenCalledOnce();
    expect(mediaMock.prepareAmbientSlots).not.toHaveBeenCalled();
    expect(coordinator.getStatus()).toMatchObject({ desiredState: "stopped", mode: "stopped" });
  });

  it("cancels the old availability wait before starting an operator restart", async () => {
    vi.useFakeTimers();
    const client = {
      health: vi.fn().mockRejectedValue(new Error("offline")),
      getPlayback: vi.fn(),
    };
    storageMock.setSystemSetting.mockResolvedValue(undefined);
    storageMock.getNextSession.mockResolvedValue(undefined);
    storageMock.getActiveSession.mockResolvedValue(undefined);
    const coordinator = new BroadcastCoordinator("main", client as any);

    await coordinator.restart();
    await flushMicrotasks();
    const firstRunId = coordinator.getStatus().runId;
    expect(client.health).toHaveBeenCalledOnce();

    await coordinator.restart();
    await flushMicrotasks();
    expect(coordinator.getStatus().runId).not.toBe(firstRunId);
    expect(client.health).toHaveBeenCalledTimes(2);

    await coordinator.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.health).toHaveBeenCalledTimes(2);
  });

  it("resumes a single producer after both Streamer probes recover", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const client = {
      health: vi.fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ ok: true }),
      getPlayback: vi.fn().mockResolvedValue({ playbackManifestUrl: "http://localhost:8888/live/main/index.m3u8" }),
      stageUpload: vi.fn(),
      releaseSlot: vi.fn(),
    };
    storageMock.getNextSession.mockResolvedValue(undefined);
    storageMock.getActiveSession.mockResolvedValue(undefined);
    storageMock.getLastBlock.mockResolvedValue(undefined);
    mediaMock.prepareAmbientSlots.mockImplementation(async () => {
      controller.abort(new Error("one ambient iteration is enough for this test"));
      return undefined;
    });
    const coordinator = new BroadcastCoordinator("main", client as any);
    (coordinator as any).desiredState = "running";
    const producing = (coordinator as any).produce(controller.signal);

    await flushMicrotasks();
    expect(client.health).toHaveBeenCalledOnce();
    expect(mediaMock.prepareAmbientSlots).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    await flushMicrotasks();
    await producing;

    expect(client.health).toHaveBeenCalledTimes(4);
    expect(client.getPlayback).toHaveBeenCalledTimes(3);
    // Both generators probe, but the first preparation aborts the run before
    // the second can start generating — a single producer, no duplicate work.
    expect(mediaMock.prepareAmbientSlots).toHaveBeenCalledOnce();
    expect(coordinator.getStatus().streamer.state).toBe("available");
  });

  it("disposes ambient pipeline when streamer becomes unavailable", async () => {
    const client = {
      health: vi.fn()
        .mockResolvedValueOnce({ ok: true })
        .mockRejectedValueOnce(new Error("offline")),
      getPlayback: vi.fn()
        .mockResolvedValueOnce({ playbackManifestUrl: "http://localhost:8888/live/main/index.m3u8" })
        .mockRejectedValue(new Error("offline")),
      stageUpload: vi.fn(),
      releaseSlot: vi.fn(),
    };
    storageMock.getNextSession.mockResolvedValue(undefined);
    storageMock.getActiveSession.mockResolvedValue(undefined);
    const coordinator = new BroadcastCoordinator("main", client as any);
    
    // First, verify streamer is available
    await expect((coordinator as any).ensureStreamerAvailable(new AbortController().signal)).resolves.toBe(true);
    expect(coordinator.getStatus().streamer.state).toBe("available");

    // Then, trigger streamer unavailability
    await expect((coordinator as any).ensureStreamerAvailable(new AbortController().signal)).resolves.toBe(false);
    
    // Verify that ambient pipeline was disposed when streamer became unavailable
    expect(coordinator.getStatus().streamer.state).toBe("unavailable");
    // Verify that the mode changed to waiting_for_streamer
    expect(coordinator.getStatus().mode).toBe("waiting_for_streamer");
  });

  it("admits only the missing canonical slots as one ordered text window", async () => {
    const session = {
      id: 9,
      channelId: "main",
      scheduledEnd: new Date(Date.now() + 60_000),
      status: "preparing",
    };
    storageMock.getBlocksBySessionOrdered.mockResolvedValue([]);
    storageMock.getLastBlock.mockResolvedValue(undefined);

    blocksMock.generateCanonicalStoryWindow.mockResolvedValue([
      { content: "Text block 1", title: "Block 1" },
      { content: "Text block 2", title: "Block 2" },
    ]);
    let nextId = 0;
    mediaMock.finishCanonicalSlot.mockImplementation(async (_channelId: string, _session: any, generated: any) => {
      nextId += 1;
      return {
        block: { id: nextId, content: generated.content, deliverySegments: [{ ordinal: 0, durationSeconds: 15 }] },
        slots: [{
          durationSeconds: 15,
          idempotencyPrefix: `channel:main:session:9:block:${nextId}:segment:0`,
          slotKey: `channel:main:session:9:block:${nextId}:segment:0:slot`,
          segmentOrdinal: 0,
        }],
      };
    });

    const client = {
      health: vi.fn().mockResolvedValue({ ok: true }),
      getPlayback: vi.fn().mockResolvedValue({ playbackManifestUrl: "http://localhost:8888/live/main/index.m3u8" }),
      stageUpload: vi.fn(async (input: { mediaType: string }) => job(`${input.mediaType}-job`, "staged")),
      releaseSlot: vi.fn(async (slotKey: string) => ({ jobs: [job(`image-${slotKey}`, "queued")] })),
    };
    const coordinator = new BroadcastCoordinator("main", client as any);
    (coordinator as any).streamer = { state: "available" };

    await (coordinator as any).ensureStagedSlots(session, 2, new AbortController().signal);

    expect(blocksMock.generateCanonicalStoryWindow).toHaveBeenCalledWith("main", "", 2, 9);
    expect(mediaMock.finishCanonicalSlot).toHaveBeenCalledTimes(2);
  });

  it("parallelizes ambient prep across workers with narrowed mutex while preserving split-sibling contiguity", async () => {
    let activeGenerations = 0;
    let maxConcurrentGenerations = 0;
    const gen0Deferred = deferred<any>();
    const gen1Deferred = deferred<any>();
    const releasedSlots: string[] = [];

    storageMock.setSystemSetting.mockResolvedValue(undefined);
    storageMock.getNextSession.mockResolvedValue(undefined);
    storageMock.getActiveSession.mockResolvedValue(undefined);
    storageMock.getLastBlock.mockResolvedValue(undefined);

    mediaMock.prepareAmbientSlots.mockImplementation(async (_channelId: string, _context: string, _runId: string, sequence: number) => {
      activeGenerations += 1;
      maxConcurrentGenerations = Math.max(maxConcurrentGenerations, activeGenerations);
      try {
        if (sequence === 0) {
          return await gen0Deferred.promise;
        }
        if (sequence === 1) {
          return await gen1Deferred.promise;
        }
        return undefined;
      } finally {
        activeGenerations -= 1;
      }
    });

    const client = {
      health: vi.fn().mockResolvedValue({ ok: true }),
      getPlayback: vi.fn().mockResolvedValue({ playbackManifestUrl: "http://localhost:8888/live/main/index.m3u8" }),
      stageUpload: vi.fn(async (input: { mediaType: string }) => job(`${input.mediaType}-job`, "staged")),
      releaseSlot: vi.fn(async (slotKey: string) => {
        releasedSlots.push(slotKey);
        return { jobs: [job(`job-${slotKey}`, "done")] };
      }),
      watchJob: vi.fn(async function* (jobId: string) {
        yield job(jobId, "done");
      }),
    };

    const coordinator = new BroadcastCoordinator("main", client as any);
    await coordinator.restart();
    await flushMicrotasks(60);

    // Both workers should be generating in flight concurrently!
    expect(maxConcurrentGenerations).toBe(2);

    // Resolve gen 0 with split turn (2 segments)
    gen0Deferred.resolve({
      ...ambientTurn(0),
      segments: [
        { segmentOrdinal: 0, durationSeconds: 12 },
        { segmentOrdinal: 1, durationSeconds: 12 },
      ],
      totalDurationSeconds: 24,
    });

    // Resolve gen 1 with 1 segment
    gen1Deferred.resolve(ambientTurn(1));

    await flushMicrotasks(120);

    // Verify split sibling segments released contiguously first, followed by gen 1
    expect(releasedSlots[0]).toContain("sequence:0:segment:0");
    expect(releasedSlots[1]).toContain("sequence:0:segment:1");
    expect(releasedSlots[2]).toContain("sequence:1:segment:0");

    await coordinator.stop();
  });

  it("does not consume an old prefetch when admitting a canonical window", async () => {
    const session = {
      id: 9,
      channelId: "main",
      scheduledEnd: new Date(Date.now() + 60_000),
      status: "preparing",
    };
    storageMock.getBlocksBySessionOrdered.mockResolvedValue([]);
    storageMock.getLastBlock.mockResolvedValue(undefined);

    const client = {
      health: vi.fn().mockResolvedValue({ ok: true }),
      getPlayback: vi.fn().mockResolvedValue({ playbackManifestUrl: "http://localhost:8888/live/main/index.m3u8" }),
      stageUpload: vi.fn(async (input: { mediaType: string }) => job(`${input.mediaType}-job`, "staged")),
      releaseSlot: vi.fn(async (slotKey: string) => ({ jobs: [job(`image-${slotKey}`, "queued")] })),
    };
    const coordinator = new BroadcastCoordinator("main", client as any);
    (coordinator as any).streamer = { state: "available" };

    blocksMock.generateCanonicalStoryWindow.mockResolvedValue([{ content: "fresh text", title: "Fresh" }]);
    mediaMock.finishCanonicalSlot.mockResolvedValue({
      block: { id: 1, content: "fresh text", deliverySegments: [{ ordinal: 0, durationSeconds: 15 }] },
      slots: [{
        durationSeconds: 15,
        idempotencyPrefix: "channel:main:session:9:block:1:segment:0",
        slotKey: "channel:main:session:9:block:1:segment:0:slot",
        segmentOrdinal: 0,
      }],
    });

    await (coordinator as any).ensureStagedSlots(session, 1, new AbortController().signal);

    expect(blocksMock.generateCanonicalStoryWindow).toHaveBeenCalledWith("main", "", 1, 9);
    expect(mediaMock.finishCanonicalSlot).toHaveBeenCalledWith(
      "main",
      session,
      expect.objectContaining({ title: "Fresh", content: "fresh text" }),
      expect.anything(),
    );
  });

  it("does not deadlock the ambient commit chain when an earlier concurrent worker fails", async () => {
    const gen0Deferred = deferred<any>();
    const gen1Deferred = deferred<any>();
    const releasedSlots: string[] = [];

    storageMock.setSystemSetting.mockResolvedValue(undefined);
    storageMock.getNextSession.mockResolvedValue(undefined);
    storageMock.getActiveSession.mockResolvedValue(undefined);
    storageMock.getLastBlock.mockResolvedValue(undefined);

    mediaMock.prepareAmbientSlots.mockImplementation(async (_channelId: string, _context: string, _runId: string, sequence: number) => {
      if (sequence === 0) return await gen0Deferred.promise;
      if (sequence === 1) return await gen1Deferred.promise;
      return undefined;
    });

    const client = {
      health: vi.fn().mockResolvedValue({ ok: true }),
      getPlayback: vi.fn().mockResolvedValue({ playbackManifestUrl: "http://localhost:8888/live/main/index.m3u8" }),
      stageUpload: vi.fn(async (input: { mediaType: string }) => job(`${input.mediaType}-job`, "staged")),
      releaseSlot: vi.fn(async (slotKey: string) => {
        releasedSlots.push(slotKey);
        return { jobs: [job(`job-${slotKey}`, "done")] };
      }),
      watchJob: vi.fn(async function* (jobId: string) {
        yield job(jobId, "done");
      }),
    };

    const coordinator = new BroadcastCoordinator("main", client as any);
    await coordinator.restart();
    await flushMicrotasks(60);

    // Worker 0 fails/returns undefined (e.g. image provider failure)
    gen0Deferred.resolve(undefined);
    // Worker 1 succeeds concurrently
    gen1Deferred.resolve(ambientTurn(1));

    await flushMicrotasks(120);

    // Worker 1 must not hang behind Worker 0's failure; its slot must be released
    expect(releasedSlots.length).toBeGreaterThanOrEqual(1);
    expect(releasedSlots[0]).toContain("sequence:1:segment:0");

    await coordinator.stop();
  });
});

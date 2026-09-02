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
}));

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("./media-slots", () => mediaMock);

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

  it("advances the persisted canonical cursor after a terminal slot failure", async () => {
    const firstSlot = { ...slot, imageJobId: "image-job", audioJobId: "audio-job" };
    const secondSlot = { ...slot, idempotencyPrefix: slot.idempotencyPrefix.replace(/:0$/, ":1"), slotKey: `${slot.slotKey}:next`, segmentOrdinal: 1, imageJobId: "image-job-2", audioJobId: "audio-job-2" };
    const block = { id: 8, deliverySegments: [{ audioUrl: "https://assets.example/one.wav" }, { audioUrl: "https://assets.example/two.wav" }] };
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
      return [];
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

    expect(client.health).toHaveBeenCalledTimes(3);
    expect(client.getPlayback).toHaveBeenCalledTimes(2);
    expect(mediaMock.prepareAmbientSlots).toHaveBeenCalledOnce();
    expect(coordinator.getStatus().streamer.state).toBe("available");
  });
});

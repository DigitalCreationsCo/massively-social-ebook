import { afterEach, describe, expect, it, vi } from "vitest";

const blocks = vi.hoisted(() => ({ generateStoryBlock: vi.fn() }));
const images = vi.hoisted(() => ({ archiveStoryImage: vi.fn(), generateStoryImageAsset: vi.fn() }));
const speech = vi.hoisted(() => ({ archiveSpeechBuffer: vi.fn(), synthesizeNarrationBuffers: vi.fn() }));
const storage = vi.hoisted(() => ({ createBlock: vi.fn(), getRandomImage: vi.fn() }));

vi.mock("../blocks/ai", () => blocks);
vi.mock("../image-uploader", () => images);
vi.mock("../media/tts-service", () => speech);
vi.mock("../storage", () => ({ storage }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { prepareAmbientSlots, prepareCanonicalSlot, slotsFromBlock } from "./media-slots";

describe("broadcast media slots", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.BROADCAST_IMAGE_ONLY_DURATION_SECONDS;
  });

  it("releases a generated image as an image-only slot after three failed TTS attempts", async () => {
    blocks.generateStoryBlock.mockResolvedValue({ title: "A door opens", content: "The room is quiet.", dialogue: "The room is quiet." });
    images.generateStoryImageAsset.mockResolvedValue({ buffer: Buffer.from("image"), mimeType: "image/jpeg", filename: "scene.jpg" });
    images.archiveStoryImage.mockResolvedValue("https://archive.example/scene.jpg");
    speech.synthesizeNarrationBuffers.mockRejectedValue(new Error("Bark unavailable"));
    storage.createBlock.mockResolvedValue({ id: 7 });
    process.env.BROADCAST_IMAGE_ONLY_DURATION_SECONDS = "15";

    const prepared = await prepareCanonicalSlot(
      "main",
      { id: 3 } as any,
      "",
      new AbortController().signal,
    );

    expect(speech.synthesizeNarrationBuffers).toHaveBeenCalledTimes(3);
    expect(prepared.slots).toHaveLength(1);
    expect(prepared.slots[0]).toMatchObject({
      durationSeconds: 15,
      slotKey: "channel:main:session:3:block:7:segment:0:slot",
      image: expect.any(Object),
    });
    expect(prepared.slots[0]?.audio).toBeUndefined();
    expect(storage.createBlock).toHaveBeenCalledWith(expect.objectContaining({
      ttsEnabled: false,
      audioUrl: null,
      deliverySegments: [{ durationSeconds: 15, ordinal: 0 }],
    }));
  }, 5_000);

  it("retains legacy pair receipts while reading new individual slot receipts", () => {
    const slots = slotsFromBlock({
      id: 7,
      channelId: "main",
      sessionId: 3,
      deliverySegments: [
        { ordinal: 0, durationSeconds: 8, audioUrl: "https://archive.example/a.wav", queuePairId: "legacy-pair" },
        {
          ordinal: 1,
          durationSeconds: 15,
          queueSlotKey: "turn:1",
          queueImageJobId: "image-1",
        },
      ],
    } as any);

    expect(slots).toMatchObject([
      { queuePairId: "legacy-pair" },
      { slotKey: "turn:1", imageJobId: "image-1" },
    ]);
  });

  it("uses default 15 second duration when environment variable is not set", async () => {
    blocks.generateStoryBlock.mockResolvedValue({ title: "A door opens", content: "The room is quiet.", dialogue: "The room is quiet." });
    images.generateStoryImageAsset.mockResolvedValue({ buffer: Buffer.from("image"), mimeType: "image/jpeg", filename: "scene.jpg" });
    images.archiveStoryImage.mockResolvedValue("https://archive.example/scene.jpg");
    speech.synthesizeNarrationBuffers.mockRejectedValue(new Error("Bark unavailable"));
    storage.createBlock.mockResolvedValue({ id: 7 });

    const prepared = await prepareCanonicalSlot(
      "main",
      { id: 3 } as any,
      "",
      new AbortController().signal,
    );

    expect(speech.synthesizeNarrationBuffers).toHaveBeenCalledTimes(3);
    expect(prepared.slots).toHaveLength(1);
    expect(prepared.slots[0]).toMatchObject({
      durationSeconds: 15,
      slotKey: "channel:main:session:3:block:7:segment:0:slot",
      image: expect.any(Object),
    });
    expect(prepared.slots[0]?.audio).toBeUndefined();
    expect(storage.createBlock).toHaveBeenCalledWith(expect.objectContaining({
      ttsEnabled: false,
      audioUrl: null,
      deliverySegments: [{ durationSeconds: 15, ordinal: 0 }],
    }));
  }, 5_000);

  it("keeps one in-memory image asset for all ambient narration segments", async () => {
    blocks.generateStoryBlock.mockResolvedValue({ title: "A door opens", content: "One. Two.", dialogue: "One. Two." });
    images.generateStoryImageAsset.mockResolvedValue({ buffer: Buffer.from("image"), mimeType: "image/jpeg", filename: "scene.jpg" });
    speech.synthesizeNarrationBuffers.mockResolvedValue([
      { speech: { buffer: Buffer.from("audio-one"), durationSeconds: 4, extension: "wav", mimeType: "audio/wav" } },
      { speech: { buffer: Buffer.from("audio-two"), durationSeconds: 5, extension: "wav", mimeType: "audio/wav" } },
    ]);

    const prepared = await prepareAmbientSlots("main", "", "run-1", 7, new AbortController().signal);

    expect(prepared).toMatchObject({
      sequence: 7,
      idempotencyPrefix: "channel:main:run:run-1:sequence:7",
      totalDurationSeconds: 9,
      segments: [{ segmentOrdinal: 0, durationSeconds: 4 }, { segmentOrdinal: 1, durationSeconds: 5 }],
    });
    expect(prepared?.image.data.size).toBe(5);
    expect(prepared?.totalBytes).toBe(5 + 9 + 9);
  });

  it("uses an image-only ambient turn when narrative generation is unavailable", async () => {
    vi.useFakeTimers();
    try {
      blocks.generateStoryBlock.mockRejectedValue(new Error("Structured output unavailable"));
      images.generateStoryImageAsset.mockResolvedValue({ buffer: Buffer.from("image"), mimeType: "image/jpeg", filename: "scene.jpg" });
      speech.synthesizeNarrationBuffers.mockRejectedValue(new Error("Bark unavailable"));

      const pending = prepareAmbientSlots("main", "Prior scene.", "run-1", 8, new AbortController().signal);
      await Promise.resolve();
      await Promise.resolve();
      await vi.runAllTimersAsync();
      const prepared = await pending;

      expect(prepared).toMatchObject({
        sequence: 8,
        segments: [{ segmentOrdinal: 0, durationSeconds: 15 }],
      });
      expect(prepared?.segments[0]?.audio).toBeUndefined();
      expect(images.generateStoryImageAsset).toHaveBeenCalledWith(
        expect.stringContaining("Ambient interlude"),
        expect.objectContaining({ imageRepresentations: [], signal: expect.anything() }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards identical selected references through canonical generation", async () => {
    const refs = [{ entityId: "nap://r/character/a", representationKey: "k", hash: "h1", format: "png" }];
    const signal = new AbortController().signal;
    blocks.generateStoryBlock.mockResolvedValue({
      title: "T",
      content: "C",
      dialogue: "D",
      imageRepresentations: refs,
    });
    images.generateStoryImageAsset.mockResolvedValue({ buffer: Buffer.from("image"), mimeType: "image/jpeg", filename: "s.jpg" });
    images.archiveStoryImage.mockResolvedValue("https://archive.example/s.jpg");
    speech.synthesizeNarrationBuffers.mockResolvedValue([]);
    storage.createBlock.mockResolvedValue({ id: 9 });

    await prepareCanonicalSlot("main", { id: 3 } as never, "", signal);

    expect(images.generateStoryImageAsset).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ imageRepresentations: refs, signal }),
    );
  });

  it("forwards identical selected references through ambient generation", async () => {
    const refs = [{ entityId: "nap://r/character/a", representationKey: "k", hash: "h1", format: "png" }];
    const signal = new AbortController().signal;
    blocks.generateStoryBlock.mockResolvedValue({
      title: "T",
      content: "C",
      dialogue: "D",
      selectedImageRepresentations: refs,
    });
    images.generateStoryImageAsset.mockResolvedValue({ buffer: Buffer.from("image"), mimeType: "image/jpeg", filename: "s.jpg" });
    speech.synthesizeNarrationBuffers.mockResolvedValue([]);

    await prepareAmbientSlots("main", "ctx", "run-1", 3, signal);

    expect(images.generateStoryImageAsset).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ imageRepresentations: refs, signal }),
    );
  });

  it("preserves archived-image fallback when generation exhausts retries", async () => {
    blocks.generateStoryBlock.mockResolvedValue({ title: "T", content: "C", dialogue: "D", imageRepresentations: [] });
    images.generateStoryImageAsset.mockRejectedValue(new Error("provider down"));
    storage.getRandomImage.mockResolvedValue("https://archive.example/fallback.jpg");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(Buffer.from("fallback-bytes") as unknown as BodyInit, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
    speech.synthesizeNarrationBuffers.mockResolvedValue([]);
    try {
      const prepared = await prepareAmbientSlots("main", "ctx", "run-1", 4, new AbortController().signal);
      expect(prepared?.image).toBeDefined();
      expect(storage.getRandomImage).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

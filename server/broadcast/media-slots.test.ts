import { afterEach, describe, expect, it, vi } from "vitest";

const blocks = vi.hoisted(() => ({ generateStoryBlock: vi.fn() }));
const images = vi.hoisted(() => ({ archiveStoryImage: vi.fn(), generateStoryImageAsset: vi.fn(), downloadArchiveBuffer: vi.fn() }));
const speech = vi.hoisted(() => ({ archiveSpeechBuffer: vi.fn(), synthesizeNarrationBuffers: vi.fn() }));
const storage = vi.hoisted(() => ({ createBlock: vi.fn(), getLastBlock: vi.fn(), getRandomImage: vi.fn() }));

vi.mock("../blocks/ai", () => blocks);
vi.mock("../image-uploader", () => images);
vi.mock("../media/tts-service", () => speech);
vi.mock("../storage", () => ({ storage }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { prepareAmbientTurnFromText, prepareCanonicalSlot, slotsFromBlock } from "./media-slots";

describe("broadcast media slots", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.BROADCAST_IMAGE_ONLY_DURATION_SECONDS;
    delete process.env.BROADCAST_IMAGE_DURATION_SECONDS;
    delete process.env.BROADCAST_NARRATION_ATTEMPTS;
  });

  it("releases a generated image as an image-only slot after a single failed TTS attempt", async () => {
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

    expect(speech.synthesizeNarrationBuffers).toHaveBeenCalledTimes(1);
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

  it("uses default 15 second duration for image-only turns when no variable is set", async () => {
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

    expect(speech.synthesizeNarrationBuffers).toHaveBeenCalledTimes(1);
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

  it("retries narration up to BROADCAST_NARRATION_ATTEMPTS when configured", async () => {
    process.env.BROADCAST_NARRATION_ATTEMPTS = "3";
    blocks.generateStoryBlock.mockResolvedValue({ title: "A door opens", content: "The room is quiet.", dialogue: "The room is quiet." });
    images.generateStoryImageAsset.mockResolvedValue({ buffer: Buffer.from("image"), mimeType: "image/jpeg", filename: "scene.jpg" });
    images.archiveStoryImage.mockResolvedValue("https://archive.example/scene.jpg");
    speech.synthesizeNarrationBuffers.mockRejectedValue(new Error("transient TTS flake"));
    storage.createBlock.mockResolvedValue({ id: 7 });
    try {
      const prepared = await prepareCanonicalSlot(
        "main",
        { id: 3 } as any,
        "",
        new AbortController().signal,
      );
      expect(speech.synthesizeNarrationBuffers).toHaveBeenCalledTimes(3);
      expect(prepared.slots).toHaveLength(1);
      expect(prepared.slots[0]?.audio).toBeUndefined();
    } finally {
      delete process.env.BROADCAST_NARRATION_ATTEMPTS;
    }
  }, 10_000);

  it("ignores invalid BROADCAST_NARRATION_ATTEMPTS and uses a single attempt", async () => {
    process.env.BROADCAST_NARRATION_ATTEMPTS = "banana";
    blocks.generateStoryBlock.mockResolvedValue({ title: "A door opens", content: "The room is quiet.", dialogue: "The room is quiet." });
    images.generateStoryImageAsset.mockResolvedValue({ buffer: Buffer.from("image"), mimeType: "image/jpeg", filename: "scene.jpg" });
    images.archiveStoryImage.mockResolvedValue("https://archive.example/scene.jpg");
    speech.synthesizeNarrationBuffers.mockRejectedValue(new Error("Bark unavailable"));
    storage.createBlock.mockResolvedValue({ id: 7 });
    try {
      await prepareCanonicalSlot("main", { id: 3 } as any, "", new AbortController().signal);
      expect(speech.synthesizeNarrationBuffers).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.BROADCAST_NARRATION_ATTEMPTS;
    }
  }, 5_000);

  it("holds short narrated images for the full floor instead of the TTS length", async () => {
    images.generateStoryImageAsset.mockResolvedValue({ buffer: Buffer.from("image"), mimeType: "image/jpeg", filename: "scene.jpg" });
    speech.synthesizeNarrationBuffers.mockResolvedValue([
      { speech: { buffer: Buffer.from("audio-one"), durationSeconds: 4, extension: "wav", mimeType: "audio/wav" } },
      { speech: { buffer: Buffer.from("audio-two"), durationSeconds: 5, extension: "wav", mimeType: "audio/wav" } },
    ]);

    const prepared = await prepareAmbientTurnFromText("main", { title: "A door opens", content: "One. Two.", dialogue: "One. Two." }, "run-1", 7, new AbortController().signal);

    expect(prepared).toMatchObject({
      sequence: 7,
      idempotencyPrefix: "channel:main:run:run-1:sequence:7",
      contentId: "channel:main:run:run-1:sequence:7",
      totalDurationSeconds: 24,
      segments: [{ segmentOrdinal: 0, durationSeconds: 12 }, { segmentOrdinal: 1, durationSeconds: 12 }],
    });
    expect(prepared?.image.data.size).toBe(5);
    expect(prepared?.totalBytes).toBe(5 + 9 + 9);
  });

  it("preserves long narration verbatim instead of truncating to the floor", async () => {
    images.generateStoryImageAsset.mockResolvedValue({ buffer: Buffer.from("image"), mimeType: "image/jpeg", filename: "scene.jpg" });
    speech.synthesizeNarrationBuffers.mockResolvedValue([
      { speech: { buffer: Buffer.from("audio-long"), durationSeconds: 18, extension: "wav", mimeType: "audio/wav" } },
    ]);

    const prepared = await prepareAmbientTurnFromText("main", { title: "A door opens", content: "One.", dialogue: "One." }, "run-1", 9, new AbortController().signal);

    expect(prepared).toMatchObject({
      totalDurationSeconds: 18,
      segments: [{ segmentOrdinal: 0, durationSeconds: 18 }],
    });
  });

  it("governs image-only turns by BROADCAST_IMAGE_ONLY_DURATION_SECONDS alone", async () => {
    process.env.BROADCAST_IMAGE_DURATION_SECONDS = "20";
    process.env.BROADCAST_IMAGE_ONLY_DURATION_SECONDS = "15";
    blocks.generateStoryBlock.mockResolvedValue({ title: "A door opens", content: "The room is quiet.", dialogue: "The room is quiet." });
    images.generateStoryImageAsset.mockResolvedValue({ buffer: Buffer.from("image"), mimeType: "image/jpeg", filename: "scene.jpg" });
    images.archiveStoryImage.mockResolvedValue("https://archive.example/scene.jpg");
    speech.synthesizeNarrationBuffers.mockRejectedValue(new Error("Bark unavailable"));
    storage.createBlock.mockResolvedValue({ id: 7 });
    try {
      const prepared = await prepareCanonicalSlot(
        "main",
        { id: 3 } as any,
        "",
        new AbortController().signal,
      );
      expect(prepared.slots[0]).toMatchObject({ durationSeconds: 15 });
    } finally {
      delete process.env.BROADCAST_IMAGE_DURATION_SECONDS;
    }
  });

  it("uses an image-only ambient turn when TTS is unavailable (media fallback)", async () => {
    images.generateStoryImageAsset.mockResolvedValue({ buffer: Buffer.from("image"), mimeType: "image/jpeg", filename: "scene.jpg" });
    speech.synthesizeNarrationBuffers.mockRejectedValue(new Error("Bark unavailable"));

    const prepared = await prepareAmbientTurnFromText("main", { title: "Ambient interlude", content: "Prior scene.", dialogue: undefined }, "run-1", 8, new AbortController().signal);

    expect(prepared).toMatchObject({
      sequence: 8,
      segments: [{ segmentOrdinal: 0, durationSeconds: 15 }],
    });
    expect(prepared?.segments[0]?.audio).toBeUndefined();
    expect(images.generateStoryImageAsset).toHaveBeenCalledWith(
      expect.stringContaining("Prior scene"),
      expect.objectContaining({ imageRepresentations: [], signal: expect.anything() }),
    );
  });

  it("forwards identical selected references through canonical generation", async () => {
    const refs = [{ entityId: "px://r/character/a", representationKey: "k", hash: "h1", format: "png" }];
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
    const refs = [{ entityId: "px://r/character/a", representationKey: "k", hash: "h1", format: "png" }];
    const signal = new AbortController().signal;
    images.generateStoryImageAsset.mockResolvedValue({ buffer: Buffer.from("image"), mimeType: "image/jpeg", filename: "s.jpg" });
    speech.synthesizeNarrationBuffers.mockResolvedValue([]);

    await prepareAmbientTurnFromText("main", { title: "T", content: "C", dialogue: "D", selectedImageRepresentations: refs }, "run-1", 3, signal);

    expect(images.generateStoryImageAsset).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ imageRepresentations: refs, signal }),
    );
  });

  it("preserves archived-image fallback when generation exhausts retries", async () => {
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
      const prepared = await prepareAmbientTurnFromText("main", { title: "T", content: "C", dialogue: "D", imageRepresentations: [] }, "run-1", 4, new AbortController().signal);
      expect(prepared?.image).toBeDefined();
      expect(storage.getRandomImage).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("repeats the most recent canonical image before choosing a random fallback", async () => {
    images.generateStoryImageAsset.mockRejectedValue(new Error("quota exhausted"));
    storage.getLastBlock.mockResolvedValue({ imageUrl: "https://archive.example/latest.jpg" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(Buffer.from("latest-bytes") as unknown as BodyInit, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
    speech.synthesizeNarrationBuffers.mockResolvedValue([]);
    try {
      const prepared = await prepareAmbientTurnFromText("main", { title: "T", content: "C", dialogue: "D", imageRepresentations: [] }, "run-1", 40, new AbortController().signal);
      expect(prepared?.image).toBeDefined();
      expect(storage.getLastBlock).toHaveBeenCalledWith("main");
      expect(storage.getRandomImage).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      storage.getLastBlock.mockReset();
    }
  });

  it("recovers an archived image via SDK when public fetch returns 403", async () => {
    images.generateStoryImageAsset.mockRejectedValue(new Error("provider down"));
    storage.getRandomImage.mockResolvedValue("https://storage.googleapis.com/test-bucket/channels/main/images/ambient/x.jpg");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("forbidden", { status: 403 }),
    );
    images.downloadArchiveBuffer.mockResolvedValueOnce(Buffer.from("sdk-bytes"));
    speech.synthesizeNarrationBuffers.mockResolvedValue([]);
    try {
      const prepared = await prepareAmbientTurnFromText("main", { title: "T", content: "C", dialogue: "D", imageRepresentations: [] }, "run-1", 5, new AbortController().signal);
      expect(prepared?.image).toBeDefined();
      expect(images.downloadArchiveBuffer).toHaveBeenCalledWith(
        "https://storage.googleapis.com/test-bucket/channels/main/images/ambient/x.jpg",
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("skips the turn when a 403 archive is unreadable even via SDK", async () => {
    images.generateStoryImageAsset.mockRejectedValue(new Error("provider down"));
    storage.getRandomImage.mockResolvedValue("https://storage.googleapis.com/test-bucket/channels/main/images/ambient/y.jpg");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("forbidden", { status: 403 }),
    );
    images.downloadArchiveBuffer.mockResolvedValue(null);
    speech.synthesizeNarrationBuffers.mockResolvedValue([]);
    try {
      const prepared = await prepareAmbientTurnFromText("main", { title: "T", content: "C", dialogue: "D", imageRepresentations: [] }, "run-1", 6, new AbortController().signal);
      expect(prepared).toBeUndefined();
      expect(images.downloadArchiveBuffer).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

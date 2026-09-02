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

import { prepareCanonicalSlot, slotsFromBlock } from "./media-slots";

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
});

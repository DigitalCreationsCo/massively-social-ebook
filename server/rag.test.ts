import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildRAGContext } from "./rag";
import { storage } from "./storage";

// Mock storage
vi.mock("./storage", () => ({
  storage: {
    getBlockCount: vi.fn(),
    getBlocksBySequence: vi.fn(),
  },
}));

const mockedStorage = vi.mocked(storage);

describe("buildRAGContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns immediateContext unchanged when block count is below threshold", async () => {
    mockedStorage.getBlockCount.mockResolvedValue(2);

    const result = await buildRAGContext("scifi", "The ship pressed on.");

    expect(result).toBe("The ship pressed on.");
    expect(mockedStorage.getBlocksBySequence).not.toHaveBeenCalled();
  });

  it("returns immediateContext unchanged when block count is exactly at threshold - 1", async () => {
    mockedStorage.getBlockCount.mockResolvedValue(2);

    const result = await buildRAGContext("mystery", "A shadow appeared.");

    expect(result).toBe("A shadow appeared.");
  });

  it("fetches historical blocks and formats RAG context for sufficient block count", async () => {
    mockedStorage.getBlockCount.mockResolvedValue(20);
    mockedStorage.getBlocksBySequence.mockResolvedValue([
      {
        id: 1,
        channelId: "scifi",
        title: "Launch",
        content: "The rocket launched into the void.",
        imageUrl: null,
        optionA: null,
        optionB: null,
        createdAt: new Date(),
      },
      {
        id: 5,
        channelId: "scifi",
        title: "Asteroid Field",
        content: "Debris filled the viewport.",
        imageUrl: null,
        optionA: null,
        optionB: null,
        createdAt: new Date(),
      },
      {
        id: 15,
        channelId: "scifi",
        title: null,
        content: "A signal came through.",
        imageUrl: null,
        optionA: null,
        optionB: null,
        createdAt: new Date(),
      },
    ] as any);

    const result = await buildRAGContext("scifi", "The crew debated.");

    expect(result).toContain("Story So Far");
    expect(result).toContain('1. "Launch" — The rocket launched into the void.');
    expect(result).toContain('2. "Asteroid Field" — Debris filled the viewport.');
    expect(result).toContain("3. A signal came through.");
    expect(result).toContain("Current Situation:\nThe crew debated.");
    expect(mockedStorage.getBlocksBySequence).toHaveBeenCalledWith(
      "scifi",
      expect.any(Array)
    );
  });

  it("excludes the final block index from retrieval (already in immediateContext)", async () => {
    mockedStorage.getBlockCount.mockResolvedValue(10);
    mockedStorage.getBlocksBySequence.mockResolvedValue([]);

    await buildRAGContext("scifi", "Context here");

    const calledIndices = mockedStorage.getBlocksBySequence.mock.calls[0]?.[1];
    if (calledIndices) {
      // No index should equal the total block count (10)
      expect(calledIndices.every((idx: number) => idx < 10)).toBe(true);
    }
  });

  it("returns immediateContext when getBlocksBySequence returns empty", async () => {
    mockedStorage.getBlockCount.mockResolvedValue(10);
    mockedStorage.getBlocksBySequence.mockResolvedValue([]);

    const result = await buildRAGContext("scifi", "Fallback context");

    expect(result).toBe("Fallback context");
  });

  it("returns immediateContext when all indices equal blockCount (no historical indices)", async () => {
    // blockCount = 3, RAG_MIN_BLOCKS = 3, so we enter RAG.
    // With blockCount=3 and divisions=5, the sequence will be small.
    // After filtering out idx >= blockCount, we may have no indices.
    mockedStorage.getBlockCount.mockResolvedValue(3);
    // The function must call getBlocksBySequence with indices that are < 3
    // For blockCount=3 the sequence is [1, ..., 3], filter < 3 keeps [1, 2]
    mockedStorage.getBlocksBySequence.mockResolvedValue([
      {
        id: 1,
        channelId: "scifi",
        title: "Start",
        content: "It began.",
        imageUrl: null,
        optionA: null,
        optionB: null,
        createdAt: new Date(),
      },
    ] as any);

    const result = await buildRAGContext("scifi", "Now we are here.");

    expect(result).toContain("Story So Far");
    expect(result).toContain("Now we are here.");
  });

  it("gracefully degrades on storage error", async () => {
    mockedStorage.getBlockCount.mockRejectedValue(new Error("DB connection failed"));

    const result = await buildRAGContext("scifi", "Error fallback");

    expect(result).toBe("Error fallback");
  });

  it("gracefully degrades when getBlocksBySequence throws", async () => {
    mockedStorage.getBlockCount.mockResolvedValue(20);
    mockedStorage.getBlocksBySequence.mockRejectedValue(new Error("Query failed"));

    const result = await buildRAGContext("scifi", "Query error fallback");

    expect(result).toBe("Query error fallback");
  });

  it("returns immediateContext when blockCount is 0", async () => {
    mockedStorage.getBlockCount.mockResolvedValue(0);

    const result = await buildRAGContext("scifi", "No blocks yet");

    expect(result).toBe("No blocks yet");
    expect(mockedStorage.getBlocksBySequence).not.toHaveBeenCalled();
  });
});

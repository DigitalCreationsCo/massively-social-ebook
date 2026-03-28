import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { RagProvider } from "./rag";
import { storage } from "../storage";
import { db } from "../db";

vi.mock("../storage", () => ({
  storage: {
    getBlockCount: vi.fn(),
    getBlocksBySequence: vi.fn(),
  },
}));

vi.mock("../db", () => ({
  db: {
    select: vi.fn(),
    execute: vi.fn(),
  },
}));

vi.mock("./engine/embedding", () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

const mockedStorage = vi.mocked(storage);

describe("RagProvider", () => {
  let provider: RagProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new RagProvider();
  });

  describe("getBlockCount", () => {
    it("returns count from storage", async () => {
      mockedStorage.getBlockCount.mockResolvedValue(42);
      
      const count = await provider.getBlockCount("scifi");
      
      expect(count).toBe(42);
      expect(mockedStorage.getBlockCount).toHaveBeenCalledWith("scifi");
    });
  });

  describe("getLoreAtoms", () => {
    it("returns active lore from db", async () => {
      const mockOrderBy = vi.fn().mockResolvedValue([
        { 
          id: 1, 
          channelId: "scifi", 
          content: "Lore 1", 
          isActive: true,
          createdAt: new Date("2024-01-01T00:00:00Z") 
        }
      ]);
      const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      (db.select as unknown as Mock).mockReturnValue({ from: mockFrom });

      const atoms = await provider.getLoreAtoms("scifi");
      
      expect(atoms).toHaveLength(1);
      expect(atoms[0].content).toBe("Lore 1");
      expect((atoms[0] as any).isActive).toBe(true);
      expect(atoms[0].happenedAt).toBe(new Date("2024-01-01T00:00:00Z").getTime());
      
      expect(db.select).toHaveBeenCalled();
      expect(mockFrom).toHaveBeenCalled();
      expect(mockWhere).toHaveBeenCalled();
      expect(mockOrderBy).toHaveBeenCalled();
    });

    it("handles null createdAt gracefully", async () => {
      const mockOrderBy = vi.fn().mockResolvedValue([
        { id: 2, channelId: "scifi", content: "Lore 2", createdAt: null }
      ]);
      const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      (db.select as unknown as Mock).mockReturnValue({ from: mockFrom });

      const atoms = await provider.getLoreAtoms("scifi");
      
      expect(atoms[0].happenedAt).toBeTypeOf("number");
    });
  });

  describe("getHybridSearchCandidates", () => {
    it("returns candidates with computed scores", async () => {
      (db.execute as unknown as Mock).mockResolvedValue({
        rows: [
          {
            id: 1,
            channel_id: "scifi",
            title: "Block 1",
            content: "Content 1",
            image_url: null,
            option_a: null,
            option_b: null,
            is_notable: false,
            embedding: null,
            created_at: new Date("2024-01-01T00:00:00Z"),
            score_vector_dense: "0.85",
            score_keyword_sparse: "0.5"
          }
        ]
      });

      const candidates = await provider.getHybridSearchCandidates("scifi", "alien encounter", 10);
      
      expect(candidates).toHaveLength(1);
      expect(candidates[0].block.id).toBe(1);
      expect(candidates[0].block.content).toBe("Content 1");
      expect(candidates[0].block.happenedAt).toBe(new Date("2024-01-01T00:00:00Z").getTime());
      expect(candidates[0].scoreVectorDense).toBe(0.85);
      expect(candidates[0].scoreKeywordSparse).toBe(0.5);
      
      expect(db.execute).toHaveBeenCalled();
    });

    it("handles default zero scores if missing in row", async () => {
      (db.execute as unknown as Mock).mockResolvedValue({
        rows: [
          {
            id: 2,
            channel_id: "scifi",
            content: "Content 2",
            created_at: null,
            score_vector_dense: null,
            score_keyword_sparse: null
          }
        ]
      });

      const candidates = await provider.getHybridSearchCandidates("scifi", "query", 5);
      
      expect(candidates[0].scoreVectorDense).toBe(0);
      expect(candidates[0].scoreKeywordSparse).toBe(0);
      expect(candidates[0].block.happenedAt).toBe(0);
    });
  });

  describe("getNotableEvents", () => {
    it("returns notable blocks from db", async () => {
      const mockOrderBy = vi.fn().mockResolvedValue([
        { 
          id: 1, 
          channelId: "scifi", 
          content: "Notable event", 
          isNotable: true, 
          createdAt: new Date("2024-01-01T00:00:00Z") 
        }
      ]);
      const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      (db.select as unknown as Mock).mockReturnValue({ from: mockFrom });

      const events = await provider.getNotableEvents("scifi");
      
      expect(events).toHaveLength(1);
      expect(events[0].content).toBe("Notable event");
      expect((events[0] as any).isNotable).toBe(true);
      expect(events[0].happenedAt).toBe(new Date("2024-01-01T00:00:00Z").getTime());
    });

    it("handles null createdAt properly", async () => {
      const mockOrderBy = vi.fn().mockResolvedValue([
        { id: 2, channelId: "scifi", content: "Notable 2", isNotable: true, createdAt: null }
      ]);
      const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      (db.select as unknown as Mock).mockReturnValue({ from: mockFrom });

      const events = await provider.getNotableEvents("scifi");
      
      expect(events[0].happenedAt).toBeTypeOf("number");
    });
  });

  describe("getBlocksByIndices", () => {
    it("returns blocks at positions mapped correctly", async () => {
      mockedStorage.getBlocksBySequence.mockResolvedValue([
        { 
          id: 1, 
          channelId: "scifi", 
          content: "Block sequence", 
          createdAt: new Date("2024-01-01T00:00:00Z") 
        } as any
      ]);

      const blocks = await provider.getBlocksByIndices("scifi", [0, 1]);
      
      expect(blocks).toHaveLength(1);
      expect(blocks[0].content).toBe("Block sequence");
      expect(blocks[0].happenedAt).toBe(new Date("2024-01-01T00:00:00Z").getTime());
      
      expect(mockedStorage.getBlocksBySequence).toHaveBeenCalledWith("scifi", [0, 1]);
    });

    it("handles null createdAt properly", async () => {
      mockedStorage.getBlocksBySequence.mockResolvedValue([
        { id: 2, channelId: "scifi", content: "Block sequence 2", createdAt: null } as any
      ]);

      const blocks = await provider.getBlocksByIndices("scifi", [5]);
      
      expect(blocks[0].happenedAt).toBeTypeOf("number");
    });
  });
});

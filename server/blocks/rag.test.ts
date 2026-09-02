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

const mockGenerateEmbedding = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);

vi.mock("./embedding", () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

const mockedStorage = vi.mocked(storage);

describe("RagProvider", () => {
  let provider: RagProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new RagProvider();
  });

  describe("constructor with useEmbeddings option", () => {
    it("defaults to useEmbeddings true for backward compatibility", () => {
      const defaultProvider = new RagProvider();
      expect((defaultProvider as any).useEmbeddings).toBe(true);
    });

    it("respects useEmbeddings false option", () => {
      const providerNoEmbeddings = new RagProvider({ useEmbeddings: false });
      expect((providerNoEmbeddings as any).useEmbeddings).toBe(false);
    });

    it("respects useEmbeddings true option", () => {
      const providerWithEmbeddings = new RagProvider({ useEmbeddings: true });
      expect((providerWithEmbeddings as any).useEmbeddings).toBe(true);
    });
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
            narrative_index: 1,
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
            narrative_index: 2,
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

    it("skips embedding generation when useEmbeddings is false", async () => {
      const providerNoEmbeddings = new RagProvider({ useEmbeddings: false });
      
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
            narrative_index: 1,
            score_vector_dense: "0",
            score_keyword_sparse: "0.5"
          }
        ]
      });

      const candidates = await providerNoEmbeddings.getHybridSearchCandidates("scifi", "alien encounter", 10);
      
      expect(candidates).toHaveLength(1);
      expect(candidates[0].scoreVectorDense).toBe(0);
      expect(candidates[0].scoreKeywordSparse).toBe(0.5);
      
      // Verify that generateEmbedding was not called when useEmbeddings is false
      expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    });

    it("uses embedding generation when useEmbeddings is true (default)", async () => {
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
            narrative_index: 1,
            score_vector_dense: "0.85",
            score_keyword_sparse: "0.5"
          }
        ]
      });

      const candidates = await provider.getHybridSearchCandidates("scifi", "alien encounter", 10);
      
      expect(candidates).toHaveLength(1);
      expect(candidates[0].scoreVectorDense).toBe(0.85);
      
      // Verify that generateEmbedding was called when useEmbeddings is true
      expect(mockGenerateEmbedding).toHaveBeenCalledWith("alien encounter");
    });
  });

  describe("getNotableEvents", () => {
    it("returns notable blocks from db", async () => {
      (db.execute as unknown as Mock).mockResolvedValue({
        rows: [{
          id: 1,
          narrative_index: 1,
          channel_id: "scifi",
          content: "Notable event",
          is_notable: true,
          created_at: new Date("2024-01-01T00:00:00Z"),
        }],
      });

      const events = await provider.getNotableEvents("scifi");
      
      expect(events).toHaveLength(1);
      expect(events[0].content).toBe("Notable event");
      expect((events[0] as any).isNotable).toBe(true);
      expect(events[0].happenedAt).toBe(new Date("2024-01-01T00:00:00Z").getTime());
    });

    it("handles null createdAt properly", async () => {
      (db.execute as unknown as Mock).mockResolvedValue({
        rows: [{
          id: 2,
          narrative_index: 2,
          channel_id: "scifi",
          content: "Notable 2",
          is_notable: true,
          created_at: null,
        }],
      });

      const events = await provider.getNotableEvents("scifi");
      
      expect(events[0].happenedAt).toBeTypeOf("number");
    });
  });

  describe("getBlocksByIndices", () => {
    it("returns blocks at positions mapped correctly", async () => {
      (db.execute as unknown as Mock).mockResolvedValue({
        rows: [{
          id: 1,
          narrative_index: 1,
          channel_id: "scifi",
          content: "Block sequence",
          created_at: new Date("2024-01-01T00:00:00Z"),
        }],
      });

      const blocks = await provider.getBlocksByIndices("scifi", [0, 1]);
      
      expect(blocks).toHaveLength(1);
      expect(blocks[0].content).toBe("Block sequence");
      expect(blocks[0].happenedAt).toBe(new Date("2024-01-01T00:00:00Z").getTime());
      
      expect(db.execute).toHaveBeenCalled();
    });

    it("handles null createdAt properly", async () => {
      (db.execute as unknown as Mock).mockResolvedValue({
        rows: [{
          id: 2,
          narrative_index: 5,
          channel_id: "scifi",
          content: "Block sequence 2",
          created_at: null,
        }],
      });

      const blocks = await provider.getBlocksByIndices("scifi", [5]);
      
      expect(blocks[0].happenedAt).toBeTypeOf("number");
    });

    it("does not query for an empty index list", async () => {
      await expect(provider.getBlocksByIndices("scifi", [])).resolves.toEqual([]);
      expect(db.execute).not.toHaveBeenCalled();
    });
  });
});

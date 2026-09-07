// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { NarrativeEngine } from "@portalshq/narrativeengine";
import { RagProvider } from "./rag";

describe("RagProvider SQLite integration", () => {
  let database: DatabaseSync;
  let provider: RagProvider;

  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE blocks (
        id INTEGER PRIMARY KEY,
        channel_id TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        image_url TEXT,
        option_a TEXT,
        option_b TEXT,
        is_notable INTEGER NOT NULL,
        embedding TEXT,
        created_at TEXT
      ) STRICT;
      CREATE TABLE lore (
        id INTEGER PRIMARY KEY,
        channel_id TEXT NOT NULL,
        content TEXT NOT NULL,
        is_active INTEGER NOT NULL,
        created_at TEXT
      ) STRICT;
    `);

    database.prepare(
      "INSERT INTO blocks (id, channel_id, title, content, image_url, option_a, option_b, is_notable, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(1, "alpha", "Council convenes", "The council convenes; the council controls the observatory.", null, null, null, 1, "[1,0]", "2026-01-01T00:00:00.000Z");
    database.prepare(
      "INSERT INTO blocks (id, channel_id, title, content, image_url, option_a, option_b, is_notable, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(2, "alpha", "Council fractures", "The council splits after a disputed vote.", null, null, null, 0, "[0.8,0.2]", "2026-01-02T00:00:00.000Z");
    database.prepare(
      "INSERT INTO blocks (id, channel_id, title, content, image_url, option_a, option_b, is_notable, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(3, "beta", "Other channel", "The council is unrelated to alpha.", null, null, null, 1, "[1,0]", "2026-01-03T00:00:00.000Z");
    database.prepare(
      "INSERT INTO lore (id, channel_id, content, is_active, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(1, "alpha", "The observatory is off-limits.", 1, "2026-01-04T00:00:00.000Z");
    database.prepare(
      "INSERT INTO lore (id, channel_id, content, is_active, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(2, "alpha", "This inactive fact must not appear.", 0, "2026-01-05T00:00:00.000Z");
    database.prepare(
      "INSERT INTO lore (id, channel_id, content, is_active, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(3, "beta", "Beta-only lore.", 1, "2026-01-06T00:00:00.000Z");

    provider = new RagProvider({
      sqlite: database,
      generateEmbedding: vi.fn().mockResolvedValue([1, 0]),
      useEmbeddings: true,
    });
  });

  afterEach(() => {
    database.close();
  });

  it("implements every retrieval method against isolated, persisted channel data", async () => {
    expect(provider.getProviderType()).toBe("rag-sqlite");
    await expect(provider.getBlockCount("alpha")).resolves.toBe(2);

    const lore = await provider.getLoreAtoms("alpha");
    expect(lore).toMatchObject([
      {
        id: 1,
        channelId: "alpha",
        content: "The observatory is off-limits.",
        isActive: true,
        happenedAt: Date.parse("2026-01-04T00:00:00.000Z"),
      },
    ]);

    const candidates = await provider.getHybridSearchCandidates("alpha", "council", 10);
    expect(candidates).toHaveLength(2);
    expect(candidates).toMatchObject([
      {
        block: { id: 1, channelId: "alpha", isNotable: true },
        scoreVectorDense: 1,
        scoreKeywordSparse: 1,
      },
      {
        block: { id: 2, channelId: "alpha", isNotable: false },
        scoreKeywordSparse: 0.5,
      },
    ]);
    await expect(provider.getHybridSearchCandidates("alpha", "council", 1)).resolves.toHaveLength(1);

    await expect(provider.getNotableEvents("alpha")).resolves.toMatchObject([
      { id: 1, channelId: "alpha", isNotable: true },
    ]);
    await expect(provider.getNewestBlocks("alpha", 1)).resolves.toMatchObject([
      { id: 2, index: 2, channelId: "alpha" },
    ]);
    await expect(provider.getNewestNotableBlocks("alpha", 1, ["1"])).resolves.toEqual([]);
    await expect(provider.getBlocksByIndices("alpha", [2, 3])).resolves.toMatchObject([
      { id: 2, channelId: "alpha", content: "The council splits after a disputed vote." },
    ]);
    await expect(provider.getBlocksByIndices("alpha", [])).resolves.toEqual([]);

    const inserted = await provider.insertBlock("alpha", {
      title: "A generated turn",
      content: "The observatory opens again.",
      isNotable: true,
      happenedAt: Date.parse("2026-01-07T00:00:00.000Z"),
    });
    expect(inserted).toMatchObject({
      id: 4,
      index: 3,
      channelId: "alpha",
      title: "A generated turn",
      content: "The observatory opens again.",
      isNotable: true,
      happenedAt: Date.parse("2026-01-07T00:00:00.000Z"),
    });
    await expect(provider.getBlockCount("alpha")).resolves.toBe(3);
    await expect(provider.getBlockCount("beta")).resolves.toBe(1);
  });

  it("runs retrieval, PX, generation, persistence, and later-request block caching end to end", async () => {
    const getBlocksByIndices = vi.spyOn(provider, "getBlocksByIndices");
    const order: string[] = [];
    const engine = new NarrativeEngine({
      dataProvider: provider,
      pxProvider: {
        enrichContext: vi.fn(async () => {
          order.push("px");
          return {
            entities: [{ id: "observatory", name: "Observatory", type: "location" }],
            representations: [{
              id: "observatory-image",
              entityName: "Observatory",
              name: "image",
              format: "png",
              uri: "https://signed.example/observatory.png",
              property: "image",
            }],
          };
        }),
      },
      generationProvider: {
        generateBlock: vi.fn(async ({ context }) => {
          order.push("generate");
          expect(context.entities[0]?.name).toBe("Observatory");
          return {
            title: "Generated continuation",
            content: "A hidden stair appears beneath the observatory.",
            happenedAt: Date.parse("2026-01-08T00:00:00.000Z"),
          };
        }),
      },
      config: { representationProperties: ["image"] },
    });

    const generated = await engine.generateBlock({ channelId: "alpha", inputQuery: "Continue" });
    order.push("persisted");
    expect(generated.block).toMatchObject({
      id: 4,
      index: 3,
      channelId: "alpha",
      content: "A hidden stair appears beneath the observatory.",
    });
    expect(order).toEqual(["px", "generate", "persisted"]);
    await expect(provider.getBlockCount("alpha")).resolves.toBe(3);

    getBlocksByIndices.mockClear();
    await engine.buildContext({ channelId: "alpha", inputQuery: "silence" });
    expect(getBlocksByIndices).toHaveBeenCalledTimes(1);
    expect(getBlocksByIndices).toHaveBeenCalledWith("alpha", [2]);

    await engine.buildContext({ channelId: "alpha", inputQuery: "silence again" });
    expect(getBlocksByIndices).toHaveBeenCalledTimes(1);
  });

  it("skips embedding generation when useEmbeddings is false in SQLite mode", async () => {
    const mockGenerateEmbedding = vi.fn().mockResolvedValue([1, 0]);
    const providerNoEmbeddings = new RagProvider({
      sqlite: database,
      generateEmbedding: mockGenerateEmbedding,
      useEmbeddings: false,
    });

    const candidates = await providerNoEmbeddings.getHybridSearchCandidates("alpha", "council", 10);
    
    expect(candidates).toHaveLength(2);
    expect(candidates[0].scoreVectorDense).toBe(0);
    expect(candidates[1].scoreVectorDense).toBe(0);
    
    // Verify that generateEmbedding was not called when useEmbeddings is false
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  it("uses embedding generation when useEmbeddings is true in SQLite mode", async () => {
    const mockGenerateEmbedding = vi.fn().mockResolvedValue([1, 0]);
    const providerWithEmbeddings = new RagProvider({
      sqlite: database,
      generateEmbedding: mockGenerateEmbedding,
      useEmbeddings: true,
    });

    const candidates = await providerWithEmbeddings.getHybridSearchCandidates("alpha", "council", 10);
    
    expect(candidates).toHaveLength(2);
    expect(candidates[0].scoreVectorDense).toBe(1);
    
    // Verify that generateEmbedding was called when useEmbeddings is true
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("council");
  });
});

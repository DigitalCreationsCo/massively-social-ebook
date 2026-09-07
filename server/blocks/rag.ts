import { sql, asc, eq, and } from "drizzle-orm";
import { blocks, lore } from "@shared/schema";
import type {
  HybridCandidate,
  NarrativeBlock as BaseNarrativeBlock,
  NarrativeBlockInput,
  NarrativeDataProvider,
  NarrativeLore as BaseNarrativeLore,
} from "@portalshq/narrativeengine";

/**
 * NarrativeEngine asks its four RAG read methods at once.  Letting every
 * simultaneous block-generation fan out four pg requests was enough to
 * exhaust the shared application pool during playback/session activity.
 *
 * Keep this deliberately small and module-wide: separate RagProvider
 * instances must not each create their own burst.  This only serializes the
 * short database portions of context retrieval; embedding work is unaffected.
 */
const RAG_DB_CONCURRENCY = 1;
let activeRagDbQueries = 0;
const ragDbWaiters: Array<() => void> = [];

async function withRagDbSlot<T>(operation: () => Promise<T>): Promise<T> {
  if (activeRagDbQueries >= RAG_DB_CONCURRENCY) {
    await new Promise<void>((resolve) => ragDbWaiters.push(resolve));
  }

  activeRagDbQueries += 1;
  try {
    return await operation();
  } finally {
    activeRagDbQueries -= 1;
    ragDbWaiters.shift()?.();
  }
}

interface SqliteStatement {
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
}

export interface RagProviderOptions {
  /**
   * An optional SQLite backend for local development and integration testing.
   * When omitted, the provider retains its PostgreSQL/pgvector implementation.
   */
  sqlite?: SqliteDatabase;
  generateEmbedding?: (query: string) => Promise<number[]>;
  /**
   * Whether to generate and use embeddings in searchCandidates.
   * When false, embedding generation is skipped and vector search is disabled.
   * Defaults to true for backward compatibility.
   */
  useEmbeddings?: boolean;
}

type SqliteBlockRow = {
  id: number;
  channel_id: string;
  title: string | null;
  content: string;
  image_url: string | null;
  option_a: unknown;
  option_b: unknown;
  is_notable: number | boolean | null;
  embedding: string | null;
  created_at: string | Date | null;
  narrative_index?: number;
};

function toTimestamp(value: string | Date | null): number {
  return value ? new Date(value).getTime() : 0;
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dotProduct += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dotProduct / Math.sqrt(leftMagnitude * rightMagnitude);
}

function keywordScore(content: string, query: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;

  const normalizedContent = content.toLowerCase();
  return terms.reduce((score, term) => {
    const occurrences = normalizedContent.split(term).length - 1;
    return score + occurrences;
  }, 0) / terms.length;
}

export class RagProvider
  implements NarrativeDataProvider<BaseNarrativeBlock, BaseNarrativeLore, NarrativeBlockInput>
{
  private readonly useEmbeddings: boolean;

  constructor(private readonly options: RagProviderOptions = {}) {
    // Embeddings are opt-in: normal context retrieval stays entirely in Postgres.
    this.useEmbeddings = this.options.useEmbeddings === true;
  }

  getProviderType(): string {
    return this.options.sqlite ? "rag-sqlite" : "rag-pg";
  }

  async getBlockCount(channelId: string): Promise<number> {
    if (this.options.sqlite) {
      const row = this.options.sqlite
        .prepare("SELECT COUNT(*) AS count FROM blocks WHERE channel_id = ?")
        .get(channelId) as { count: number };
      return row.count;
    }

    return await withRagDbSlot(async () => {
      const { storage } = await import("../storage");
      return await storage.getBlockCount(channelId);
    });
  }

  async getLoreAtoms(channelId: string): Promise<BaseNarrativeLore[]> {
    if (this.options.sqlite) {
      const rows = this.options.sqlite
        .prepare(
          "SELECT id, channel_id, content, is_active, created_at FROM lore WHERE channel_id = ? AND is_active = 1 ORDER BY id ASC",
        )
        .all(channelId) as Array<{
          id: number;
          channel_id: string;
          content: string;
          is_active: number | boolean;
          created_at: string | Date | null;
        }>;

      return rows.map((row) => ({
        id: row.id,
        channelId: row.channel_id,
        content: row.content,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at ? new Date(row.created_at) : null,
        happenedAt: toTimestamp(row.created_at),
      }));
    }

    const result = await withRagDbSlot(async () => {
      const { db } = await import("../db");
      return await db
        .select()
        .from(lore)
        .where(and(eq(lore.channelId, channelId), eq(lore.isActive, true)))
        .orderBy(asc(lore.id));
    });
    return result.map(row => ({
      ...row,
      createdAt: row.createdAt ? new Date(row.createdAt) : null,
      happenedAt: row.createdAt ? new Date(row.createdAt).getTime() : new Date().getTime()
    }));
  }

  async getHybridSearchCandidates(channelId: string, query: string, limit: number): Promise<HybridCandidate<BaseNarrativeBlock>[]> {
    if (this.options.sqlite) {
      const generateEmbedding = this.options.generateEmbedding;
      if (this.useEmbeddings && !generateEmbedding) {
        throw new Error("RagProvider SQLite mode requires a generateEmbedding function when useEmbeddings is true.");
      }

      const queryEmbedding = this.useEmbeddings && generateEmbedding ? await generateEmbedding(query) : null;
      const rows = this.options.sqlite
        .prepare(
          "SELECT * FROM (SELECT id, channel_id, title, content, image_url, option_a, option_b, is_notable, embedding, created_at, ROW_NUMBER() OVER (ORDER BY id ASC) AS narrative_index FROM blocks WHERE channel_id = ?) numbered WHERE lower(content) LIKE ? ORDER BY narrative_index ASC",
        )
        .all(channelId, `%${query.toLowerCase()}%`) as SqliteBlockRow[];
      const keywordScores = rows.map((row) => keywordScore(row.content, query));
      const highestKeywordScore = Math.max(...keywordScores, 0);

      return rows.map((row, index) => {
        const embedding = row.embedding ? JSON.parse(row.embedding) as number[] : [];
        return {
          block: {
            id: row.id,
            index: row.narrative_index ?? row.id,
            channelId: row.channel_id,
            title: row.title,
            content: row.content,
            imageUrl: row.image_url,
            optionA: row.option_a,
            optionB: row.option_b,
            isNotable: Boolean(row.is_notable),
            embedding,
            createdAt: row.created_at ? new Date(row.created_at) : null,
            happenedAt: toTimestamp(row.created_at),
          },
          scoreVectorDense: this.useEmbeddings && queryEmbedding ? cosineSimilarity(embedding, queryEmbedding) : 0,
          scoreKeywordSparse: highestKeywordScore === 0 ? 0 : keywordScores[index] / highestKeywordScore,
        };
      }).sort((left, right) =>
        this.useEmbeddings && queryEmbedding
          ? right.scoreVectorDense - left.scoreVectorDense || right.scoreKeywordSparse - left.scoreKeywordSparse
          : right.scoreKeywordSparse - left.scoreKeywordSparse,
      ).slice(0, limit);
    }

    const { db } = await import("../db");
    
    let result;
    if (this.useEmbeddings) {
      const { generateEmbedding } = await import("./embedding");
      const queryEmbedding = await generateEmbedding(query);
      const queryEmbeddingStr = JSON.stringify(queryEmbedding);

      result = await withRagDbSlot(() => db.execute(sql`
            WITH
              channel_blocks AS (
                SELECT
                  b.*,
                  ROW_NUMBER() OVER (ORDER BY b.id ASC) AS narrative_index
                FROM blocks b
                WHERE b.channel_id = ${channelId}
              ),
              matched_blocks AS (
                SELECT 
                  b.id,
                  b.channel_id,
                  b.title,
                  b.content,
                  b.image_url,
                  b.option_a,
                  b.option_b,
                  b.is_notable,
                  b.embedding,
                  b.created_at,
                  b.narrative_index,
                  ts_rank(b.search_vector, plainto_tsquery('english', ${query})) AS raw_ts_rank
                FROM channel_blocks b
                WHERE b.embedding IS NOT NULL
                  AND b.search_vector @@ plainto_tsquery('english', ${query})
              ),
              max_ts AS (
                SELECT COALESCE(MAX(raw_ts_rank), 1) as max_rank FROM matched_blocks
              )
            SELECT 
              m.*,
              1 - (m.embedding <=> ${queryEmbeddingStr}::vector) AS score_vector_dense,
              COALESCE(m.raw_ts_rank / NULLIF(mt.max_rank, 0), 0) AS score_keyword_sparse
            FROM matched_blocks m, max_ts mt
            ORDER BY score_vector_dense DESC, score_keyword_sparse DESC
            LIMIT ${limit}
          `));
    } else {
      // When useEmbeddings is false, use only keyword search
      result = await withRagDbSlot(() => db.execute(sql`
            WITH
              channel_blocks AS (
                SELECT
                  b.*,
                  ROW_NUMBER() OVER (ORDER BY b.id ASC) AS narrative_index
                FROM blocks b
                WHERE b.channel_id = ${channelId}
              ),
              matched_blocks AS (
                SELECT 
                  b.id,
                  b.channel_id,
                  b.title,
                  b.content,
                  b.image_url,
                  b.option_a,
                  b.option_b,
                  b.is_notable,
                  b.embedding,
                  b.created_at,
                  b.narrative_index,
                  ts_rank(b.search_vector, plainto_tsquery('english', ${query})) AS raw_ts_rank
                FROM channel_blocks b
                WHERE b.search_vector @@ plainto_tsquery('english', ${query})
              ),
              max_ts AS (
                SELECT COALESCE(MAX(raw_ts_rank), 1) as max_rank FROM matched_blocks
              )
            SELECT 
              m.*,
              0 AS score_vector_dense,
              COALESCE(m.raw_ts_rank / NULLIF(mt.max_rank, 0), 0) AS score_keyword_sparse
            FROM matched_blocks m, max_ts mt
            ORDER BY score_keyword_sparse DESC
            LIMIT ${limit}
          `));
    }

    return (result.rows as any[]).map(row => ({
      block: {
        id: row.id,
        index: Number(row.narrative_index),
        channelId: row.channel_id,
        title: row.title,
        content: row.content,
        imageUrl: row.image_url,
        optionA: row.option_a,
        optionB: row.option_b,
        isNotable: row.is_notable ?? false,
        embedding: row.embedding,
        createdAt: row.created_at ? new Date(row.created_at) : null,
        happenedAt: row.created_at ? new Date(row.created_at).getTime() : 0,
      },
      scoreVectorDense: Number(row.score_vector_dense) || 0,
      scoreKeywordSparse: Number(row.score_keyword_sparse) || 0,
    }));
  }

  async getNotableEvents(channelId: string): Promise<BaseNarrativeBlock[]> {
    if (this.options.sqlite) {
      const rows = this.options.sqlite
        .prepare(
          "SELECT * FROM (SELECT id, channel_id, title, content, image_url, option_a, option_b, is_notable, embedding, created_at, ROW_NUMBER() OVER (ORDER BY id ASC) AS narrative_index FROM blocks WHERE channel_id = ?) numbered WHERE is_notable = 1 ORDER BY narrative_index ASC",
        )
        .all(channelId) as SqliteBlockRow[];

      return rows.map((row) => ({
        id: row.id,
        index: row.narrative_index ?? row.id,
        channelId: row.channel_id,
        title: row.title,
        content: row.content,
        imageUrl: row.image_url,
        optionA: row.option_a,
        optionB: row.option_b,
        isNotable: Boolean(row.is_notable),
        embedding: row.embedding ? JSON.parse(row.embedding) : null,
        createdAt: row.created_at ? new Date(row.created_at) : null,
        happenedAt: toTimestamp(row.created_at),
      }));
    }

    const { db } = await import("../db");
    const result = await withRagDbSlot(() => db.execute(sql`
      WITH numbered AS (
        SELECT b.*, ROW_NUMBER() OVER (ORDER BY b.id ASC) AS narrative_index
        FROM blocks b
        WHERE b.channel_id = ${channelId}
      )
      SELECT * FROM numbered WHERE is_notable = true ORDER BY narrative_index ASC
    `));
    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      id: Number(row.id),
      index: Number(row.narrative_index),
      channelId: String(row.channel_id),
      title: typeof row.title === "string" ? row.title : null,
      content: String(row.content),
      imageUrl: typeof row.image_url === "string" ? row.image_url : null,
      optionA: row.option_a,
      optionB: row.option_b,
      isNotable: row.is_notable === true,
      embedding: row.embedding,
      createdAt: row.created_at ? new Date(String(row.created_at)) : null,
      happenedAt: row.created_at ? new Date(String(row.created_at)).getTime() : 0,
    }));
  }

  /** Fast path for a recent-first NarrativeEngine retrieval recipe. */
  async getNewestBlocks(channelId: string, limit: number): Promise<BaseNarrativeBlock[]> {
    if (limit <= 0) return [];
    if (this.options.sqlite) {
      const rows = this.options.sqlite.prepare(
        `SELECT b.*, (
          SELECT COUNT(*) FROM blocks prior
          WHERE prior.channel_id = b.channel_id AND prior.id <= b.id
        ) AS narrative_index
        FROM blocks b WHERE b.channel_id = ? ORDER BY b.id DESC LIMIT ?`,
      ).all(channelId, limit) as SqliteBlockRow[];
      return rows.map((row) => ({
        id: row.id,
        index: row.narrative_index ?? row.id,
        channelId: row.channel_id,
        title: row.title,
        content: row.content,
        imageUrl: row.image_url,
        optionA: row.option_a,
        optionB: row.option_b,
        isNotable: Boolean(row.is_notable),
        embedding: row.embedding ? JSON.parse(row.embedding) : null,
        createdAt: row.created_at ? new Date(row.created_at) : null,
        happenedAt: toTimestamp(row.created_at),
      }));
    }

    const { db } = await import("../db");
    const result = await withRagDbSlot(() => db.execute(sql`
      SELECT b.*, (
        SELECT COUNT(*) FROM blocks prior
        WHERE prior.channel_id = b.channel_id AND prior.id <= b.id
      ) AS narrative_index
      FROM blocks b WHERE b.channel_id = ${channelId}
      ORDER BY b.id DESC LIMIT ${limit}
    `));
    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      id: Number(row.id),
      index: Number(row.narrative_index),
      channelId: String(row.channel_id),
      title: typeof row.title === "string" ? row.title : null,
      content: String(row.content),
      imageUrl: typeof row.image_url === "string" ? row.image_url : null,
      optionA: row.option_a,
      optionB: row.option_b,
      isNotable: row.is_notable === true,
      embedding: row.embedding,
      createdAt: row.created_at ? new Date(String(row.created_at)) : null,
      happenedAt: row.created_at ? new Date(String(row.created_at)).getTime() : 0,
    }));
  }

  /** Fetch only the additional notable blocks required to fill a retrieval recipe. */
  async getNewestNotableBlocks(
    channelId: string,
    limit: number,
    excludeBlockIds: readonly string[] = [],
  ): Promise<BaseNarrativeBlock[]> {
    if (limit <= 0) return [];
    const excluded = excludeBlockIds.map(Number).filter(Number.isSafeInteger);
    if (this.options.sqlite) {
      const exclusions = excluded.length > 0
        ? ` AND b.id NOT IN (${excluded.map(() => "?").join(", ")})`
        : "";
      const rows = this.options.sqlite.prepare(
        `SELECT b.*, (
          SELECT COUNT(*) FROM blocks prior
          WHERE prior.channel_id = b.channel_id AND prior.id <= b.id
        ) AS narrative_index
        FROM blocks b WHERE b.channel_id = ? AND b.is_notable = 1${exclusions}
        ORDER BY b.id DESC LIMIT ?`,
      ).all(channelId, ...excluded, limit) as SqliteBlockRow[];
      return rows.map((row) => ({
        id: row.id,
        index: row.narrative_index ?? row.id,
        channelId: row.channel_id,
        title: row.title,
        content: row.content,
        imageUrl: row.image_url,
        optionA: row.option_a,
        optionB: row.option_b,
        isNotable: true,
        embedding: row.embedding ? JSON.parse(row.embedding) : null,
        createdAt: row.created_at ? new Date(row.created_at) : null,
        happenedAt: toTimestamp(row.created_at),
      }));
    }

    const excludedSql = excluded.length > 0
      ? sql`AND b.id NOT IN (${sql.join(excluded.map((id) => sql`${id}`), sql`, `)})`
      : sql``;
    const { db } = await import("../db");
    const result = await withRagDbSlot(() => db.execute(sql`
      SELECT b.*, (
        SELECT COUNT(*) FROM blocks prior
        WHERE prior.channel_id = b.channel_id AND prior.id <= b.id
      ) AS narrative_index
      FROM blocks b
      WHERE b.channel_id = ${channelId} AND b.is_notable = true ${excludedSql}
      ORDER BY b.id DESC LIMIT ${limit}
    `));
    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      id: Number(row.id),
      index: Number(row.narrative_index),
      channelId: String(row.channel_id),
      title: typeof row.title === "string" ? row.title : null,
      content: String(row.content),
      imageUrl: typeof row.image_url === "string" ? row.image_url : null,
      optionA: row.option_a,
      optionB: row.option_b,
      isNotable: true,
      embedding: row.embedding,
      createdAt: row.created_at ? new Date(String(row.created_at)) : null,
      happenedAt: row.created_at ? new Date(String(row.created_at)).getTime() : 0,
    }));
  }

  async getBlocksByIndices(channelId: string, indices: readonly number[]): Promise<BaseNarrativeBlock[]> {
    if (indices.length === 0) return [];

    if (this.options.sqlite) {
      const placeholders = indices.map(() => "?").join(", ");
      const rows = this.options.sqlite
        .prepare(
          `SELECT * FROM (SELECT id, channel_id, title, content, image_url, option_a, option_b, is_notable, embedding, created_at, ROW_NUMBER() OVER (ORDER BY id ASC) AS narrative_index FROM blocks WHERE channel_id = ?) numbered WHERE narrative_index IN (${placeholders}) ORDER BY narrative_index ASC`,
        )
        .all(channelId, ...indices) as SqliteBlockRow[];

      return rows.map((row) => ({
        id: row.id,
        index: row.narrative_index ?? row.id,
        channelId: row.channel_id,
        title: row.title,
        content: row.content,
        imageUrl: row.image_url,
        optionA: row.option_a,
        optionB: row.option_b,
        isNotable: Boolean(row.is_notable),
        embedding: row.embedding ? JSON.parse(row.embedding) : null,
        createdAt: row.created_at ? new Date(row.created_at) : null,
        happenedAt: toTimestamp(row.created_at),
      }));
    }

    const requestedIndices = sql.join(indices.map((index) => sql`${index}`), sql`, `);
    const { db } = await import("../db");
    const result = await withRagDbSlot(() => db.execute(sql`
      WITH numbered AS (
        SELECT b.*, ROW_NUMBER() OVER (ORDER BY b.id ASC) AS narrative_index
        FROM blocks b
        WHERE b.channel_id = ${channelId}
      )
      SELECT * FROM numbered WHERE narrative_index IN (${requestedIndices})
      ORDER BY narrative_index ASC
    `));
    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      id: Number(row.id),
      index: Number(row.narrative_index),
      channelId: String(row.channel_id),
      sessionId: Number(row.session_id),
      title: typeof row.title === "string" ? row.title : null,
      content: String(row.content),
      dialogue: typeof row.dialogue === "string" ? row.dialogue : null,
      imageUrl: typeof row.image_url === "string" ? row.image_url : null,
      optionA: row.option_a,
      optionB: row.option_b,
      ttsEnabled: row.tts_enabled !== false,
      audioUrl: typeof row.audio_url === "string" ? row.audio_url : null,
      deliverySegments: row.delivery_segments,
      isNotable: row.is_notable === true,
      embedding: row.embedding,
      createdAt: row.created_at ? new Date(String(row.created_at)) : null,
      happenedAt: row.created_at ? new Date(String(row.created_at)).getTime() : 0,
    }));
  }

  async insertBlock(channelId: string, draft: NarrativeBlockInput): Promise<BaseNarrativeBlock> {
    if (this.options.sqlite) {
      const happenedAt = typeof draft.happenedAt === "number" ? draft.happenedAt : Date.now();
      const row = this.options.sqlite
        .prepare(
          "INSERT INTO blocks (channel_id, title, content, image_url, option_a, option_b, is_notable, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, channel_id, title, content, image_url, option_a, option_b, is_notable, embedding, created_at",
        )
        .get(
          channelId,
          typeof draft.title === "string" ? draft.title : null,
          draft.content,
          typeof draft.imageUrl === "string" ? draft.imageUrl : null,
          draft.optionA === undefined ? null : JSON.stringify(draft.optionA),
          draft.optionB === undefined ? null : JSON.stringify(draft.optionB),
          draft.isNotable === true ? 1 : 0,
          Array.isArray(draft.embedding) ? JSON.stringify(draft.embedding) : null,
          new Date(happenedAt).toISOString(),
        ) as SqliteBlockRow;

      const narrativeIndex = await this.getBlockCount(channelId);
      return {
        id: row.id,
        index: narrativeIndex,
        channelId: row.channel_id,
        title: row.title,
        content: row.content,
        imageUrl: row.image_url,
        optionA: row.option_a,
        optionB: row.option_b,
        isNotable: Boolean(row.is_notable),
        embedding: row.embedding ? JSON.parse(row.embedding) : null,
        createdAt: row.created_at ? new Date(row.created_at) : null,
        happenedAt: toTimestamp(row.created_at),
      };
    }

    const sessionId = draft.sessionId;
    if (typeof sessionId !== "number") {
      throw new Error("RagProvider.insertBlock requires a numeric sessionId in PostgreSQL mode.");
    }
    const { storage } = await import("../storage");
    const row = await storage.createBlock({
      channelId,
      sessionId,
      title: typeof draft.title === "string" ? draft.title : null,
      content: draft.content,
      dialogue: typeof draft.dialogue === "string" ? draft.dialogue : null,
      imageUrl: typeof draft.imageUrl === "string" ? draft.imageUrl : null,
      optionA: draft.optionA ?? null,
      optionB: draft.optionB ?? null,
      ttsEnabled: typeof draft.ttsEnabled === "boolean" ? draft.ttsEnabled : true,
      audioUrl: typeof draft.audioUrl === "string" ? draft.audioUrl : null,
      deliverySegments: Array.isArray(draft.deliverySegments) ? draft.deliverySegments : null,
      isNotable: draft.isNotable === true,
    });
    const narrativeIndex = await this.getBlockCount(channelId);
    return {
      ...row,
      index: narrativeIndex,
      happenedAt: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
    };
  }
}

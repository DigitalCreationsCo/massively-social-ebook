import { sql, asc, eq, and } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { NarrativeProvider, BaseNarrativeBlock, BaseNarrativeLore, HybridCandidate } from "narrative-engine";
import { blocks, lore } from "@shared/schema";

export class RagProvider implements NarrativeProvider {

  async getLoreAtoms(channelId: string): Promise<BaseNarrativeLore[]> {
    const result = await db
      .select()
      .from(lore)
      .where(and(eq(lore.channelId, channelId), eq(lore.isActive, true)))
      .orderBy(asc(lore.id));
    return result.map(row => ({
      ...row,
      createdAt: row.createdAt ? new Date(row.createdAt) : null,
      happenedAt: row.createdAt ? new Date(row.createdAt).getTime() : new Date().getTime()
    }));
  }

  async getNotableEvents(channelId: string): Promise<BaseNarrativeBlock[]> {
    const result = await db
      .select()
      .from(blocks)
      .where(and(eq(blocks.channelId, channelId), eq(blocks.isNotable, true)))
      .orderBy(asc(blocks.id));
    return result.map(row => ({
      ...row,
      createdAt: row.createdAt ? new Date(row.createdAt) : null,
      happenedAt: row.createdAt ? new Date(row.createdAt).getTime() : new Date().getTime()
    }));
  }

  async getBlocksByIndices(channelId: string, indices: number[]): Promise<BaseNarrativeBlock[]> {
    return (await storage.getBlocksBySequence(channelId, indices)).map((row) => ({
      ...row,
      createdAt: row.createdAt ? new Date(row.createdAt) : null,
      happenedAt: row.createdAt ? new Date(row.createdAt).getTime() : new Date().getTime()
    }));
  }

  async getBlockCount(channelId: string): Promise<number> {
    return await storage.getBlockCount(channelId);
  }

  async getHybridSearchCandidates(channelId: string, query: string, limit: number): Promise<HybridCandidate<BaseNarrativeBlock>[]> {
    const result = await db.execute(sql`
          WITH 
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
                ts_rank(to_tsvector('english', b.content), plainto_tsquery('english', ${query})) AS raw_ts_rank
              FROM blocks b
              WHERE b.channel_id = ${channelId}
                AND b.embedding IS NOT NULL
                AND to_tsvector('english', b.content) @@ plainto_tsquery('english', ${query})
            ),
            max_ts AS (
              SELECT COALESCE(MAX(raw_ts_rank), 1) as max_rank FROM matched_blocks
            )
          SELECT 
            m.*,
            0.85 AS score_vector_dense,
            COALESCE(m.raw_ts_rank / NULLIF(mt.max_rank, 0), 0) AS score_keyword_sparse
          FROM matched_blocks m, max_ts mt
          ORDER BY score_vector_dense DESC, score_keyword_sparse DESC
          LIMIT ${limit}
        `);

    return (result.rows as any[]).map(row => ({
      block: {
        id: row.id,
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
}

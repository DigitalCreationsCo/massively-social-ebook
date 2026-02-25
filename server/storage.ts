import { db } from "./db";
import {
  blocks,
  votes,
  chat,
  sessions,
  type Block,
  type InsertBlock,
  type Vote,
  type InsertVote,
  type ChatMessage,
  type InsertChat,
  type Session,
  type InsertSession,
  type SessionStatus
} from "@shared/schema";
import { desc, eq, and, asc, count, sql } from "drizzle-orm";
export interface IStorage {
  getCurrentBlock(channelId: string): Promise<Block | undefined>;
  createBlock(block: InsertBlock): Promise<Block>;
  createVote(vote: InsertVote): Promise<Vote>;
  getRecentChat(channelId: string, limit?: number): Promise<ChatMessage[]>;
  createChat(msg: InsertChat): Promise<ChatMessage>;
  getRandomImage(channelId: string): Promise<string | null>;
  getBlockCount(channelId: string): Promise<number>;
  getBlocksBySequence(channelId: string, indices: number[]): Promise<Block[]>;
  // Session methods
  getNextSession(channelId: string): Promise<Session | undefined>;
  getActiveSession(channelId: string): Promise<Session | undefined>;
  createSession(data: InsertSession): Promise<Session>;
  updateSessionStatus(id: number, status: SessionStatus): Promise<Session>;
  listSessions(channelId?: string, status?: SessionStatus): Promise<Session[]>;
  cancelSession(id: number): Promise<Session>;
}
export class DatabaseStorage implements IStorage {
  async getCurrentBlock(channelId: string): Promise<Block | undefined> {
    const [block] = await db.select().from(blocks).where(eq(blocks.channelId, channelId)).orderBy(desc(blocks.id)).limit(1);
    return block;
  }
  async createBlock(block: InsertBlock): Promise<Block> {
    const [newBlock] = await db.insert(blocks).values(block).returning();
    return newBlock;
  }
  async getVotesForBlock(blockId: number): Promise<Vote[]> {
    return await db.select().from(votes).where(eq(votes.blockId, blockId));
  }
  async createVote(vote: InsertVote): Promise<Vote> {
    const [newVote] = await db.insert(votes).values(vote).returning();
    return newVote;
  }

  async getRecentChat(channelId: string, limit: number = 50): Promise<ChatMessage[]> {
    return await db.select().from(chat).where(eq(chat.channelId, channelId)).orderBy(desc(chat.id)).limit(limit);
  }
  async createChat(msg: InsertChat): Promise<ChatMessage> {
    const [newMsg] = await db.insert(chat).values(msg).returning();
    return newMsg;
  }
  async getRandomImage(channelId: string): Promise<string | null> {
    const allWithImages = await db.select({ imageUrl: blocks.imageUrl })
      .from(blocks)
      .where(and(eq(blocks.channelId, channelId), eq(blocks.imageUrl, blocks.imageUrl))) // This is just to ensure we only get rows with images if any
      .limit(100);

    const validImages = allWithImages.map(b => b.imageUrl).filter((url): url is string => !!url);
    if (validImages.length === 0) return null;

    return validImages[ Math.floor(Math.random() * validImages.length) ];
  }

  /**
   * Returns the total number of blocks for a given channel.
   */
  async getBlockCount(channelId: string): Promise<number> {
    const [ result ] = await db
      .select({ value: count() })
      .from(blocks)
      .where(eq(blocks.channelId, channelId));
    return result?.value ?? 0;
  }

  /**
   * Retrieves blocks at specific 1-indexed positions (ordered by ascending id)
   * for a given channel. Uses ROW_NUMBER() window function to map positions
   * to rows. If an index exceeds the block count, it is silently skipped.
   *
   * @param channelId - The channel to retrieve blocks from.
   * @param indices - 1-indexed positions of blocks to retrieve.
   * @returns Blocks at the requested positions, sorted by position (ascending).
   */
  async getBlocksBySequence(channelId: string, indices: number[]): Promise<Block[]> {
    if (indices.length === 0) return [];

    // Use a subquery with ROW_NUMBER to assign positions, then filter
    const result = await db.execute(sql`
      SELECT * FROM (
        SELECT *, ROW_NUMBER() OVER (ORDER BY id ASC) as row_num
        FROM blocks
        WHERE channel_id = ${channelId}
      ) numbered
      WHERE row_num IN (${sql.join(indices.map(i => sql`${i}`), sql`, `)})
      ORDER BY row_num ASC
    `);

    // Map raw rows back to Block type
    return (result.rows as any[]).map(row => ({
      id: row.id,
      channelId: row.channel_id,
      title: row.title,
      content: row.content,
      imageUrl: row.image_url,
      optionA: row.option_a,
      optionB: row.option_b,
      createdAt: row.created_at ? new Date(row.created_at) : null,
    })) as Block[];
  }

  // ─── Session Methods ───────────────────────────────────────────────

  /**
   * Returns the next upcoming session (status = 'scheduled') for a channel,
   * ordered by scheduledStart ascending.
   */
  async getNextSession(channelId: string): Promise<Session | undefined> {
    const [ session ] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.channelId, channelId), eq(sessions.status, 'scheduled')))
      .orderBy(asc(sessions.scheduledStart))
      .limit(1);
    return session;
  }

  /**
   * Returns the currently active session for a channel, if any.
   */
  async getActiveSession(channelId: string): Promise<Session | undefined> {
    const [ session ] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.channelId, channelId), eq(sessions.status, 'active')))
      .limit(1);
    return session;
  }

  /**
   * Creates a new session. Status defaults to 'scheduled' via the DB default.
   */
  async createSession(data: InsertSession): Promise<Session> {
    console.log('[Storage] Creating session:', data.title, 'for channel', data.channelId);
    const [ session ] = await db.insert(sessions).values(data).returning();
    return session;
  }

  /**
   * Updates the status of a session by ID.
   */
  async updateSessionStatus(id: number, status: SessionStatus): Promise<Session> {
    console.log(`[Storage] Updating session ${id} status to '${status}'`);
    const [ session ] = await db
      .update(sessions)
      .set({ status })
      .where(eq(sessions.id, id))
      .returning();
    return session;
  }

  /**
   * Lists sessions, optionally filtered by channelId and/or status.
   * Results are ordered by scheduledStart descending.
   */
  async listSessions(channelId?: string, status?: SessionStatus): Promise<Session[]> {
    const conditions = [];
    if (channelId) conditions.push(eq(sessions.channelId, channelId));
    if (status) conditions.push(eq(sessions.status, status));

    const query = db.select().from(sessions);
    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(desc(sessions.scheduledStart));
    }
    return await query.orderBy(desc(sessions.scheduledStart));
  }

  /**
   * Cancels a session by setting its status to 'cancelled'.
   */
  async cancelSession(id: number): Promise<Session> {
    console.log(`[Storage] Cancelling session ${id}`);
    return this.updateSessionStatus(id, 'cancelled');
  }
}
export const storage = new DatabaseStorage();
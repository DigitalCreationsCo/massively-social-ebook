
import { db } from "./db";
import { enqueueEmbeddingTask } from "./blocks/embedding-queue";
import {
  channelStates,
  pendingBlocks,
  type ChannelStateRow,
  type InsertChannelState,
  type PendingBlock,
  type InsertPendingBlock,
  blocks,
  votes,
  chat,
  reactions,
  sessions,
  lore,
  channels,
  schedules,
  notificationLogs,
  type Block,
  type InsertBlock,
  type Vote,
  type InsertVote,
  type ChatMessage,
  type InsertChat,
  type Reaction,
  type InsertReaction,
  type Session,
  type InsertSession,
  type SessionStatus,
  type User,
  type InsertUser,
  type Lore,
  type InsertLore,
  type Channel,
  type InsertChannel,
  type Schedule,
  type InsertSchedule,
  type SessionWithSchedule,
  type NotificationLog,
  type InsertNotificationLog,
  users,
  systemSettings,
} from "@shared/schema";
import { desc, eq, and, asc, count, sql, lte, lt, isNull, or, gte } from "drizzle-orm";

export interface IStorage {
  getCurrentBlock(channelId: string): Promise<Block | undefined>;
  createBlock(block: InsertBlock): Promise<Block>;

  createVote(vote: InsertVote): Promise<Vote>;
  getVotesForBlock(blockId: number): Promise<Vote[]>;
  getVotesBySession(sessionId: number): Promise<Vote[]>;
  getRecentChat(channelId: string, sessionId: number | undefined, limit?: number): Promise<ChatMessage[]>;
  createChat(msg: InsertChat): Promise<ChatMessage>;

  addReaction(reaction: InsertReaction): Promise<Reaction>;
  getReactionsForBlock(blockId: number): Promise<Reaction[]>;

  getRandomImage(channelId: string): Promise<string | null>;

  getBlockCount(channelId: string): Promise<number>;
  getBlocksBySequence(channelId: string, indices: number[]): Promise<Block[]>;
  getBlocksBySession(sessionId: number): Promise<Block[]>;

  createLore(loreEntry: InsertLore): Promise<Lore>;
  deactivateLore(id: number): Promise<Lore>;
  getLore(channelId?: string): Promise<Lore[]>;
  setBlockEmbedding(blockId: number, embedding: number[]): Promise<void>;
  setBlockNotable(blockId: number, isNotable: boolean): Promise<void>;

  getChannels(): Promise<Channel[]>;
  getActiveChannels(): Promise<Channel[]>;
  getChannel(channelId: string): Promise<Channel | undefined>;
  createChannel(channel: InsertChannel): Promise<Channel>;
  updateChannel(id: number, channel: Partial<InsertChannel>): Promise<Channel>;
  deleteChannel(id: number): Promise<void>;

  getNextSession(channelId: string): Promise<Session | undefined>;
  getActiveSession(channelId: string): Promise<Session | undefined>;
  getSessionWithSchedule(sessionId: number): Promise<SessionWithSchedule | undefined>;
  getSessionsInWindow(channelId: string, dateStart: Date, dateEnd: Date, statusStr?: SessionStatus): Promise<Session[]>;
  getGlobalSessionsInWindow(dateStart: Date, dateEnd: Date, statusStr?: SessionStatus): Promise<Session[]>;
  getExpiredActiveSessions(now: Date): Promise<Session[]>;

  createSession(data: InsertSession): Promise<Session>;
  createSessionWithScheduleUpdate(sessionData: InsertSession, scheduleId: number): Promise<Session>;
  updateSession(id: number, data: Partial<Session>): Promise<Session>;
  updateSessionStatus(id: number, status: SessionStatus): Promise<Session>;
  listSessions(channelId?: string, status?: SessionStatus): Promise<Session[]>;
  cancelSession(id: number): Promise<Session>;

  createSchedule(data: InsertSchedule): Promise<Schedule>;
  getSchedulesByChannel(channelId: string): Promise<Schedule[]>;
  getSchedule(id: number): Promise<Schedule | undefined>;
  updateSchedule(id: number, data: Partial<InsertSchedule>): Promise<Schedule>;
  updateScheduleNextRunAt(id: number, nextRunAt: Date): Promise<void>;
  deleteSchedule(id: number): Promise<void>;
  listSchedules(options?: { channelId?: string, onlyEnabled?: boolean; }): Promise<Schedule[]>;
  getDueSchedules(now: Date): Promise<Schedule[]>;

  getUsers(page?: number, limit?: number): Promise<{ users: User[]; total: number }>;
  createUser(user: InsertUser): Promise<User>;
  getUserByEmail(email: string): Promise<User | undefined>;
  updateUserPushToken(email: string, token: string): Promise<User>;
  banUser(id: number, banned: boolean): Promise<User>;
  getSystemSetting(key: string): Promise<string | undefined>;
  setSystemSetting(key: string, value: string): Promise<void>;
  createNotificationLog(log: InsertNotificationLog): Promise<void>;
  getNotificationLog(type: string, targetId: string): Promise<NotificationLog | undefined>;
}

export class DatabaseStorage implements IStorage {
  async getCurrentBlock(channelId: string): Promise<Block | undefined> {
    const [block] = await db
      .select()
      .from(blocks)
      .innerJoin(sessions, eq(blocks.sessionId, sessions.id))
      .where(and(
        eq(sessions.channelId, channelId),
        eq(sessions.status, 'active')
      ))
      .orderBy(desc(blocks.id))
      .limit(1);
    return block?.blocks ?? undefined;
  }

  async createBlock(block: InsertBlock): Promise<Block> {
    const [newBlock] = await db.insert(blocks).values(block).returning();
    enqueueEmbeddingTask(newBlock.id, newBlock.content, newBlock.title ?? undefined);
    return newBlock;
  }

  async getVotesForBlock(blockId: number): Promise<Vote[]> {
    return await db.select().from(votes).where(eq(votes.blockId, blockId));
  }

  async createVote(vote: InsertVote): Promise<Vote> {
    const [newVote] = await db.insert(votes).values(vote).returning();
    return newVote;
  }

  async getVotesBySession(sessionId: number): Promise<Vote[]> {
    return await db.select().from(votes).where(eq(votes.sessionId, sessionId));
  }

  async getRecentChat(channelId: string, sessionId: number | undefined, limit: number = 50): Promise<ChatMessage[]> {
    if (sessionId !== undefined) {
      return await db.select().from(chat)
        .where(and(eq(chat.channelId, channelId), eq(chat.sessionId, sessionId)))
        .orderBy(desc(chat.id))
        .limit(limit);
    }
    return [];
  }

  async createChat(msg: InsertChat): Promise<ChatMessage> {
    const [newMsg] = await db.insert(chat).values(msg).returning();
    return newMsg;
  }

  async addReaction(reaction: InsertReaction): Promise<Reaction> {
    const [newReaction] = await db.insert(reactions).values(reaction).returning();
    return newReaction;
  }

  async getReactionsForBlock(blockId: number): Promise<Reaction[]> {
    return await db.select().from(reactions).where(eq(reactions.blockId, blockId));
  }

  async getRandomImage(channelId: string): Promise<string | null> {
    const allWithImages = await db.select({ imageUrl: blocks.imageUrl })
      .from(blocks)
      .innerJoin(sessions, eq(blocks.sessionId, sessions.id))
      .where(eq(sessions.channelId, channelId))
      .limit(100);

    const validImages = allWithImages.map(b => b.imageUrl).filter((url): url is string => !!url);
    if (validImages.length === 0) return null;

    return validImages[Math.floor(Math.random() * validImages.length)];
  }

  async getBlockCount(channelId: string): Promise<number> {
    const [result] = await db
      .select({ value: count() })
      .from(blocks)
      .innerJoin(sessions, eq(blocks.sessionId, sessions.id))
      .where(eq(sessions.channelId, channelId));
    return result?.value ?? 0;
  }

  async getBlocksBySequence(channelId: string, indices: number[]): Promise<Block[]> {
    if (indices.length === 0) return [];

    const result = await db.execute(sql`
      SELECT b.*, ROW_NUMBER() OVER (ORDER BY b.id ASC) as row_num
      FROM blocks b
      INNER JOIN sessions s ON b.session_id = s.id
      WHERE s.channel_id = ${channelId}
    `);

    const numberedRows = (result.rows as any[]).filter(row => 
      indices.includes(row.row_num)
    ).sort((a, b) => a.row_num - b.row_num);

    return numberedRows.map(row => ({
      id: row.id,
      channelId: row.channel_id,
      sessionId: row.session_id,
      title: row.title,
      content: row.content,
      imageUrl: row.image_url,
      optionA: row.option_a,
      optionB: row.option_b,
      isNotable: row.is_notable ?? false,
      embedding: row.embedding,
      createdAt: row.created_at ? new Date(row.created_at) : null,
    })) as Block[];
  }

  async getBlocksBySession(sessionId: number): Promise<Block[]> {
    return await db.select().from(blocks)
      .where(eq(blocks.sessionId, sessionId))
      .orderBy(asc(blocks.id));
  }

  async createLore(loreEntry: InsertLore): Promise<Lore> {
    const [newLore] = await db.insert(lore).values(loreEntry).returning();
    return newLore;
  }

  async deactivateLore(id: number): Promise<Lore> {
    const [updatedLore] = await db
      .update(lore)
      .set({ isActive: false })
      .where(eq(lore.id, id))
      .returning();
    return updatedLore;
  }

  async setBlockEmbedding(blockId: number, embedding: number[]): Promise<void> {
    await db
      .update(blocks)
      .set({ embedding: embedding as any })
      .where(eq(blocks.id, blockId));
  }

  async setBlockNotable(blockId: number, isNotable: boolean): Promise<void> {
    await db
      .update(blocks)
      .set({ isNotable })
      .where(eq(blocks.id, blockId));
  }

  async getChannels(): Promise<Channel[]> {
    return await db.select().from(channels).orderBy(asc(channels.id));
  }

  /**
   * Returns channels that have at least one active or scheduled session.
   * Used by the game loop and scheduler to determine which channels to process.
   */
  async getActiveChannels(): Promise<Channel[]> {
    const LOOKAHEAD_DAYS = 7;
    const lookaheadDate = new Date(Date.now() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

    const result = await db
      .selectDistinct({ channel: channels })
      .from(channels)
      .innerJoin(sessions, eq(sessions.channelId, channels.channelId))
      .where(
        and(
          or(
            eq(sessions.status, 'active'),
            eq(sessions.status, 'scheduled')
          ),
          lte(sessions.scheduledStart, lookaheadDate)
        )
      )
      .orderBy(asc(channels.id));

    return result.map(r => r.channel);
  }

  async getChannel(channelId: string): Promise<Channel | undefined> {
    const [channel] = await db.select().from(channels).where(eq(channels.channelId, channelId));
    return channel;
  }

  async createChannel(channel: InsertChannel): Promise<Channel> {
    const [newChannel] = await db.insert(channels).values(channel).returning();
    return newChannel;
  }

  async updateChannel(id: number, channel: Partial<InsertChannel>): Promise<Channel> {
    const [updated] = await db
      .update(channels)
      .set(channel)
      .where(eq(channels.id, id))
      .returning();
    return updated;
  }

  async deleteChannel(id: number): Promise<void> {
    await db.delete(channels).where(eq(channels.id, id));
  }

  async getNextSession(channelId: string): Promise<Session | undefined> {
    const [session] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.channelId, channelId), eq(sessions.status, 'scheduled')))
      .orderBy(asc(sessions.scheduledStart))
      .limit(1);
    return session;
  }

  async getActiveSession(channelId: string): Promise<Session | undefined> {
    const [session] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.channelId, channelId), eq(sessions.status, 'active')))
      .limit(1);
    return session;
  }

  async getSessionWithSchedule(sessionId: number): Promise<SessionWithSchedule | undefined> {
    const [row] = await db
      .select({
        session: sessions,
        schedule: schedules,
      })
      .from(sessions)
      .leftJoin(schedules, eq(sessions.scheduleId, schedules.id))
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!row) return undefined;
    return {
      ...row.session,
      schedule: row.schedule ?? null,
    };
  }

  async getSessionsInWindow(
    channelId: string,
    dateStart: Date,
    dateEnd: Date,
    statusStr: SessionStatus = 'scheduled'
  ): Promise<Session[]> {
    console.debug(`[Trace] Fetching ${statusStr} sessions for channel ${channelId} between ${dateStart.toISOString()} and ${dateEnd.toISOString()}`, 'storage');
    try {
      return await db
        .select()
        .from(sessions)
        .where(and(
          eq(sessions.channelId, channelId),
          eq(sessions.status, statusStr),
          gte(sessions.scheduledStart, dateStart),
          lte(sessions.scheduledStart, dateEnd)
        ))
        .orderBy(asc(sessions.scheduledStart));
    } catch (errorUncaught) {
      console.error(`Failed to fetch sessions in window for ${channelId}`, 'storage', errorUncaught instanceof Error ? errorUncaught : new Error(String(errorUncaught)));
      throw errorUncaught;
    }
  }

  async getGlobalSessionsInWindow(
    dateStart: Date,
    dateEnd: Date,
    statusStr: SessionStatus = 'scheduled'
  ): Promise<Session[]> {
    try {
      return await db
        .select()
        .from(sessions)
        .where(and(
          eq(sessions.status, statusStr),
          gte(sessions.scheduledStart, dateStart),
          lte(sessions.scheduledStart, dateEnd)
        ));
    } catch (errorUncaught) {
      console.error(`Failed to fetch global sessions in window`, 'storage', errorUncaught instanceof Error ? errorUncaught : new Error(String(errorUncaught)));
      throw errorUncaught;
    }
  }

  /**
 * Retrieves all sessions that are past their scheduled end time 
 * but have not yet been marked as 'completed'.
 * * @param now - The current cutoff Date (usually Date.now())
 * @returns Array of expired sessions requiring status updates
 */
  async getExpiredActiveSessions(now: Date): Promise<Session[]> {
    try {
      return await db
        .select()
        .from(sessions)
        .where(
          and(
            // Only target sessions that haven't been closed out yet
            or(
              eq(sessions.status, 'active'),
              eq(sessions.status, 'scheduled')
            ),
            // Ensure we only grab sessions where the end time has passed
            lt(sessions.scheduledEnd, now)
          )
        )
        .execute();
    } catch (error) {
      console.error('Failed to query expired sessions', 'storage', { error, now });
      throw error;
    }
  }

  async createSession(data: InsertSession): Promise<Session> {
    console.log('[Storage] Creating session:', data.title, 'for channel', data.channelId);
    const [session] = await db.insert(sessions).values(data).returning();
    return session;
  }

  async createSessionWithScheduleUpdate(sessionData: InsertSession, scheduleId: number): Promise<Session> {
    return await db.transaction(async (tx) => {
        const [session] = await tx.insert(sessions).values(sessionData).returning();
        await tx
            .update(schedules)
            .set({
                sessionCount: sql`${schedules.sessionCount} + 1`,
            })
            .where(eq(schedules.id, scheduleId));
        return session;
    });
  }

  async updateSessionStatus(id: number, status: SessionStatus): Promise<Session> {
    console.log(`[Storage] Updating session ${id} status to '${status}'`);
    const [session] = await db
      .update(sessions)
      .set({ status })
      .where(eq(sessions.id, id))
      .returning();
    return session;
  }

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

  async cancelSession(id: number): Promise<Session> {
    console.log(`[Storage] Cancelling session ${id}`);
    return this.updateSessionStatus(id, 'cancelled');
  }

  async updateSession(id: number, data: Partial<Session>): Promise<Session> {
    const [session] = await db
      .update(sessions)
      .set(data)
      .where(eq(sessions.id, id))
      .returning();
    return session;
  }

  async createSchedule(data: InsertSchedule): Promise<Schedule> {
    console.log('[Storage] Creating schedule for channel:', data.channelId);
    const [schedule] = await db.insert(schedules).values(data).returning();
    return schedule;
  }

  async getSchedulesByChannel(channelId: string): Promise<Schedule[]> {
    return await db.select().from(schedules)
      .where(eq(schedules.channelId, channelId))
      .orderBy(desc(schedules.createdAt));
  }

  async getSchedule(id: number): Promise<Schedule | undefined> {
    const [schedule] = await db.select().from(schedules).where(eq(schedules.id, id));
    return schedule;
  }

  async updateSchedule(id: number, data: Partial<InsertSchedule>): Promise<Schedule> {
    const [schedule] = await db
      .update(schedules)
      .set(data)
      .where(eq(schedules.id, id))
      .returning();
    return schedule;
  }

  async updateScheduleNextRunAt(id: number, nextRunAt: Date): Promise<void> {
    await db
      .update(schedules)
      .set({ nextRunAt })
      .where(eq(schedules.id, id));
  }

  async deleteSchedule(id: number): Promise<void> {
    await db.delete(schedules).where(eq(schedules.id, id));
  }

  async listSchedules(options?: { channelId?: string, onlyEnabled?: boolean; }): Promise<Schedule[]> {
    try {
      const conditions = [];
      if (options?.onlyEnabled) conditions.push(eq(schedules.intervalEnabled, true));
      if (options?.channelId) conditions.push(eq(schedules.channelId, options.channelId));

      return await db
        .select()
        .from(schedules)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

    } catch (errorUncaught) {
      console.error(
        `Failed to list enabled schedules ${options?.channelId ? `for ${options.channelId}` : ''}`,
        'storage',
        errorUncaught instanceof Error ? errorUncaught : new Error(String(errorUncaught))
      );
      throw errorUncaught;
    }
  }

  async getSessionsBySchedule(scheduleId: number): Promise<Session[]> {
    return await db
      .select()
      .from(sessions)
      .where(eq(sessions.scheduleId, scheduleId));
  }

  async getDueSchedules(now: Date): Promise<Schedule[]> {
    return await db
      .select()
      .from(schedules)
      .where(and(
        eq(schedules.intervalEnabled, true),
        lte(schedules.nextRunAt, now)
      ));
  }

  async getLore(channelId?: string): Promise<Lore[]> {
    if (channelId) {
      return await db.select().from(lore).where(eq(lore.channelId, channelId));
    }
    return await db.select().from(lore);
  }

  async getUsers(page: number = 1, limit: number = 50): Promise<{ users: User[]; total: number }> {
    const offset = (page - 1) * limit;
    const [allUsers, countResult] = await Promise.all([
      db.select().from(users).orderBy(desc(users.id)).limit(limit).offset(offset),
      db.select({ value: count() }).from(users)
    ]);
    return {
      users: allUsers,
      total: countResult[0]?.value ?? 0
    };
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async updateUserPushToken(email: string, token: string): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ pushToken: token })
      .where(eq(users.email, email))
      .returning();
    return user;
  }

  async banUser(id: number, banned: boolean): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ isBanned: banned })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getSystemSetting(key: string): Promise<string | undefined> {
    const [setting] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, key));
    return setting?.value;
  }

  async setSystemSetting(key: string, value: string): Promise<void> {
    await db
      .insert(systemSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedAt: new Date() },
      });
  }

  async createNotificationLog(log: InsertNotificationLog): Promise<void> {
    await db.insert(notificationLogs).values(log);
  }

  async getNotificationLog(type: string, targetId: string): Promise<NotificationLog | undefined> {
    const [log] = await db
      .select()
      .from(notificationLogs)
      .where(and(
        eq(notificationLogs.type, type),
        eq(notificationLogs.targetId, targetId)
      ))
      .limit(1);
    return log;
  }

  async incrementScheduleSessionCount(scheduleId: number): Promise<void> {
    await db
      .update(schedules)
      .set({
        sessionCount: sql`${schedules.sessionCount} + 1`,
      })
      .where(eq(schedules.id, scheduleId));
  }

  /**
 * storage-additions.ts
 *
 * Paste these methods into your existing storage class / object.
 * They depend on:
 *   - `db`                from your drizzle connection (e.g. "../db")
 *   - table references    from "@shared/schema"
 *   - drizzle operators   from "drizzle-orm"
 *
 * After adding them, run a migration to create the two new tables:
 *   channel_states   (channelStates)
 *   pending_blocks   (pendingBlocks)
 */

  /**
   * Returns the persisted game-loop state for a channel, or null if no row
   * exists yet (first run before any session has ever started).
   */
  async getChannelState(channelId: string): Promise<ChannelStateRow | null> {
    const [ row ] = await db
      .select()
      .from(channelStates)
      .where(eq(channelStates.channelId, channelId));
    return row ?? null;
  }

  /**
   * Upserts game-loop state for a channel.  Pass only the fields you want to
   * change; everything else is left as-is.  `updatedAt` is always refreshed.
   *
   * The initial `phaseEndsAt` / `decisionEndsAt` default to NOW() so the row
   * is always valid even if called with a partial payload on first insert.
   */
  async upsertChannelState(
    channelId: string,
    data: Partial<Omit<InsertChannelState, "channelId">>
  ): Promise<ChannelStateRow> {
    const now = new Date();
    const base: InsertChannelState = {
      channelId,
      currentPhase: "reading",
      phaseEndsAt: now,
      decisionEndsAt: now,
      initialTimeToDecision: 0,
      turnsToNextChoice: 3,
      updatedAt: now,
      ...data,
    };

    const [ row ] = await db
      .insert(channelStates)
      .values(base)
      .onConflictDoUpdate({
        target: channelStates.channelId,
        set: { ...data, updatedAt: now },
      })
      .returning();

    return row;
  }

  // ─── Distributed game-loop lock ───────────────────────────────────────────────
  //
  // These two helpers implement a lightweight advisory lock stored in the
  // `processingLockedUntil` column.  The UPDATE is atomic at the DB level,
  // so even if two instances call tryAcquireGameLock at the same millisecond
  // only one will see a returned row.
  //
  // ttlMs: how long the lock is held before it expires automatically.
  //        Set this longer than the worst-case AI generation time (e.g. 90 s).

  /**
   * Attempts to atomically claim the game-loop lock for `channelId`.
   * Returns true if the lock was acquired, false if another instance holds it.
   */
  async tryAcquireGameLock(channelId: string, ttlMs: number): Promise<boolean> {
    const expiry = new Date(Date.now() + ttlMs);
    const result = await db
      .update(channelStates)
      .set({ processingLockedUntil: expiry, updatedAt: new Date() })
      .where(
        and(
          eq(channelStates.channelId, channelId),
          or(
            isNull(channelStates.processingLockedUntil),
            lt(channelStates.processingLockedUntil, new Date())
          )
        )
      )
      .returning({ channelId: channelStates.channelId });

    return result.length > 0;
  }

  /**
   * Releases the game-loop lock by clearing `processingLockedUntil`.
   * Always call this in a `finally` block after acquiring the lock.
   */
  async releaseGameLock(channelId: string): Promise<void> {
    await db
      .update(channelStates)
      .set({ processingLockedUntil: null, updatedAt: new Date() })
      .where(eq(channelStates.channelId, channelId));
  }

  // ─── Pending Blocks ───────────────────────────────────────────────────────────

  /**
   * Looks up a pre-generated continuation for a given block + choice.
   * Returns null if pre-generation hasn't finished yet (caller falls back to
   * inline generation).
   */
  async getPendingBlock(forBlockId: number, choice: "A" | "B"): Promise<PendingBlock | null> {
    const [ row ] = await db
      .select()
      .from(pendingBlocks)
      .where(
        and(
          eq(pendingBlocks.forBlockId, forBlockId),
          eq(pendingBlocks.choice, choice)
        )
      );
    return row ?? null;
  }

  /**
   * Persists a pre-generated story continuation.
   * The INSERT is ignored on conflict so fire-and-forget callers can't create
   * duplicates if triggered twice (e.g. after a restart that resumed mid-tick).
   */
  async savePendingBlock(data: InsertPendingBlock): Promise<PendingBlock> {
    const [ row ] = await db
      .insert(pendingBlocks)
      .values(data)
      .onConflictDoNothing()  // add UNIQUE(for_block_id, choice) in your migration
      .returning();
    return row;
  }

  /**
   * Deletes all pending continuations for a block once it has been consumed
   * (either used or superseded).  Call this when advancing to the next block.
   */
  async deletePendingBlocksForBlock(forBlockId: number): Promise<void> {
    await db
      .delete(pendingBlocks)
      .where(eq(pendingBlocks.forBlockId, forBlockId));
  }

  // ─── Point-lookups (new, needed by the stateless game loop) ──────────────────

  /**
   * Fetches a single block by primary key.
   * Used by the game loop instead of the in-memory `currentBlock` pointer.
   */
  async getBlockById(id: number): Promise<Block | null> {
    const [ row ] = await db
      .select()
      .from(blocks)
      .where(eq(blocks.id, id));
    return row ?? null;
  }

  /**
   * Fetches a single session by primary key.
   * Used by the game loop instead of the in-memory `activeSession` pointer.
   */
  async getSessionById(id: number): Promise<Session | null> {
    const [ row ] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id));
    return row ?? null;
  }

  /**
   * Pushes `scheduledEnd` forward (or backward) for a session.
   * Used by the debug /resolve endpoint to trigger resolution immediately.
   */
  async updateSessionScheduledEnd(id: number, scheduledEnd: Date): Promise<void> {
    await db
      .update(sessions)
      .set({ scheduledEnd })
      .where(eq(sessions.id, id));
  }

  async shouldSendWeeklyBriefing(currentWeekYear: string): Promise<boolean> {
    const lastSent = await this.getSystemSetting('last_weekly_briefing_week');
    // currentWeekYear format: "2026-14" (Year-WeekNumber)
    return lastSent !== currentWeekYear;
  }

  async markWeeklyBriefingSent(currentWeekYear: string): Promise<void> {
    await this.setSystemSetting('last_weekly_briefing_week', currentWeekYear);
  }
}

export const storage = new DatabaseStorage();

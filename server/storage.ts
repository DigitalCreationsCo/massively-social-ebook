import { db } from "./db";
import { enqueueEmbeddingTask } from "./engine/embedding-queue";
import {
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
import { desc, eq, and, asc, count, sql, lte } from "drizzle-orm";

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
  getChannel(channelId: string): Promise<Channel | undefined>;
  createChannel(channel: InsertChannel): Promise<Channel>;
  updateChannel(id: number, channel: Partial<InsertChannel>): Promise<Channel>;
  deleteChannel(id: number): Promise<void>;

  getNextSession(channelId: string): Promise<Session | undefined>;
  getActiveSession(channelId: string): Promise<Session | undefined>;
  getSessionWithSchedule(sessionId: number): Promise<SessionWithSchedule | undefined>;
  createSession(data: InsertSession): Promise<Session>;
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

  async createSession(data: InsertSession): Promise<Session> {
    console.log('[Storage] Creating session:', data.title, 'for channel', data.channelId);
    const [session] = await db.insert(sessions).values(data).returning();
    return session;
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
}

export const storage = new DatabaseStorage();

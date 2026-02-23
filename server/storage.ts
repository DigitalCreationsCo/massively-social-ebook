import { db } from "./db";
import {
  blocks,
  votes,
  chat,
  type Block,
  type InsertBlock,
  type Vote,
  type InsertVote,
  type ChatMessage,
  type InsertChat
} from "@shared/schema";
import { desc, eq, and } from "drizzle-orm";
export interface IStorage {
  getCurrentBlock(channelId: string): Promise<Block | undefined>;
  createBlock(block: InsertBlock): Promise<Block>;
  createVote(vote: InsertVote): Promise<Vote>;
  getRecentChat(channelId: string, limit?: number): Promise<ChatMessage[]>;
  createChat(msg: InsertChat): Promise<ChatMessage>;
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
}
export const storage = new DatabaseStorage();
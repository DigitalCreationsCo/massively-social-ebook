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
  getRandomImage(channelId: string): Promise<string | null>;
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
}
export const storage = new DatabaseStorage();
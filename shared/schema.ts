import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const blocks = pgTable("blocks", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const votes = pgTable("votes", {
  id: serial("id").primaryKey(),
  blockId: integer("block_id").notNull(),
  userId: text("user_id").notNull(),
  choice: text("choice").notNull(), // 'A' or 'B'
  createdAt: timestamp("created_at").defaultNow(),
});

export const chat = pgTable("chat", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBlockSchema = createInsertSchema(blocks).omit({ id: true, createdAt: true });
export const insertVoteSchema = createInsertSchema(votes).omit({ id: true, createdAt: true });
export const insertChatSchema = createInsertSchema(chat).omit({ id: true, createdAt: true });

export type Block = typeof blocks.$inferSelect;
export type InsertBlock = z.infer<typeof insertBlockSchema>;

export type Vote = typeof votes.$inferSelect;
export type InsertVote = z.infer<typeof insertVoteSchema>;

export type ChatMessage = typeof chat.$inferSelect;
export type InsertChat = z.infer<typeof insertChatSchema>;

export const WS_EVENTS = {
  SYNC_STATE: 'sync_state',
  CHAT_MESSAGE: 'chat_message',
  VOTE_UPDATE: 'vote_update',
  SUBMIT_CHAT: 'submit_chat',
  SUBMIT_VOTE: 'submit_vote'
} as const;

export type WsMessage<T = unknown> = {
  type: keyof typeof WS_EVENTS;
  payload: T;
};

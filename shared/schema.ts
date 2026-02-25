import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
  export const blocks = pgTable("blocks", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  title: text("title"),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  optionA: jsonb("option_a"), // { label: string, description: string }
  optionB: jsonb("option_b"), // { label: string, description: string }
  createdAt: timestamp("created_at").defaultNow(),
});
export const votes = pgTable("votes", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  blockId: integer("block_id").notNull(),
  userId: text("user_id").notNull(),
  choice: text("choice").notNull(), // 'A' or 'B'
  createdAt: timestamp("created_at").defaultNow(),
});
export const chat = pgTable("chat", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  username: text("username").notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type SessionStatus = 'scheduled' | 'active' | 'completed' | 'cancelled';

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  scheduledStart: timestamp("scheduled_start").notNull(),
  scheduledEnd: timestamp("scheduled_end").notNull(),
  status: text("status").notNull().default('scheduled'), // scheduled | active | completed | cancelled
  createdAt: timestamp("created_at").defaultNow(),
});
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").unique(),
  pushToken: text("push_token"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBlockSchema = createInsertSchema(blocks).omit({ id: true, createdAt: true });
export const insertVoteSchema = createInsertSchema(votes).omit({ id: true, createdAt: true });
export const insertChatSchema = createInsertSchema(chat).omit({ id: true, createdAt: true });
export const insertSessionSchema = createInsertSchema(sessions).omit({ id: true, createdAt: true, status: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });

export type Block = typeof blocks.$inferSelect;
export type InsertBlock = z.infer<typeof insertBlockSchema>;

export type Vote = typeof votes.$inferSelect;
export type InsertVote = z.infer<typeof insertVoteSchema>;

export type ChatMessage = typeof chat.$inferSelect;
export type InsertChat = z.infer<typeof insertChatSchema>;

export type Session = typeof sessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export const WS_EVENTS = {
  SYNC_STATE: 'sync_state',
  CHAT_MESSAGE: 'chat_message',
  VOTE_UPDATE: 'vote_update',
  SUBMIT_CHAT: 'submit_chat',
  SUBMIT_VOTE: 'submit_vote',
  SESSION_STATUS: 'session_status'
} as const;

export type WsMessage<T = unknown> = {
  type: keyof typeof WS_EVENTS;
  payload: T;
};

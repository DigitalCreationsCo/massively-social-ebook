import { pgTable, text, serial, timestamp, integer, jsonb, bigserial, bigint, char, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const blocks = pgTable("blocks", {
  id: bigserial("id", { mode: 'number' }).notNull(),
  sessionId: bigint("session_id", { mode: 'number' }).notNull(),
  channelId: text("channel_id").notNull(),
  title: text("title"),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  optionA: jsonb("option_a"), // { label: string, description: string }
  optionB: jsonb("option_b"), // { label: string, description: string }
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.id, table.createdAt] })
  };
});

export const votes = pgTable("votes", {
  sessionId: bigint("session_id", { mode: 'number' }).notNull(),
  blockId: bigint("block_id", { mode: 'number' }).notNull(),
  userId: text("user_id").notNull(),
  choice: char("choice", { length: 1 }).notNull(), // 'A' or 'B'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.sessionId, table.blockId, table.userId, table.createdAt] })
  };
});

export const chat = pgTable("chat", {
  id: bigserial("id", { mode: 'number' }).notNull(),
  sessionId: bigint("session_id", { mode: 'number' }).notNull(),
  channelId: text("channel_id").notNull(),
  username: text("username").notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.id, table.createdAt] })
  };
});

export const reactions = pgTable("reactions", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  sessionId: integer("session_id").notNull(),
  blockId: integer("block_id").notNull(),
  userId: text("user_id").notNull(),
  emoji: text("emoji").notNull(),
  paragraphIndex: integer("paragraph_index").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export type SessionStatus = 'scheduled' | 'active' | 'completed' | 'cancelled';

export const sessions = pgTable("sessions", {
  id: bigserial("id", { mode: 'number' }).notNull(),
  channelId: text("channel_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  scheduledStart: timestamp("scheduled_start", { withTimezone: true }).notNull(),
  scheduledEnd: timestamp("scheduled_end", { withTimezone: true }).notNull(),
  status: text("status").notNull().default('scheduled'), // scheduled | active | completed | cancelled
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.channelId, table.id] })
  };
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").unique(),
  pushToken: text("push_token"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Separated Notification Tables
export const notificationsSessionWarning = pgTable("notifications_session_warning", {
  id: bigserial("id", { mode: 'number' }).primaryKey(),
  sessionId: bigint("session_id", { mode: 'number' }).notNull(),
  userId: text("user_id").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow(),
});

export const notificationsDaily = pgTable("notifications_daily", {
  id: bigserial("id", { mode: 'number' }).primaryKey(),
  userId: text("user_id").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow(),
});

export const notificationsWeekly = pgTable("notifications_weekly", {
  id: bigserial("id", { mode: 'number' }).primaryKey(),
  userId: text("user_id").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow(),
});

// Kept for backward compatibility
export const notificationLogs = pgTable("notification_logs", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // '5_min_warning', 'weekly_brief'
  targetId: text("target_id").notNull(), // session_id or user_id
  sentAt: timestamp("sent_at").defaultNow(),
  status: text("status").notNull(), // 'sent', 'failed', 'skipped'
});


export const insertBlockSchema = createInsertSchema(blocks).omit({ id: true, createdAt: true });
// Since votes has a composite PK and no single 'id', we omit createdAt
export const insertVoteSchema = createInsertSchema(votes).omit({ createdAt: true });
export const insertChatSchema = createInsertSchema(chat).omit({ id: true, createdAt: true });
export const insertReactionSchema = createInsertSchema(reactions).omit({ id: true, createdAt: true });
export const insertSessionSchema = createInsertSchema(sessions).omit({ id: true, createdAt: true, status: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertSystemSettingsSchema = createInsertSchema(systemSettings).omit({ updatedAt: true });
export const insertNotificationLogSchema = createInsertSchema(notificationLogs).omit({ id: true, sentAt: true });


export type Block = typeof blocks.$inferSelect;
export type InsertBlock = z.infer<typeof insertBlockSchema>;

export type Vote = typeof votes.$inferSelect;
export type InsertVote = z.infer<typeof insertVoteSchema>;

export type ChatMessage = typeof chat.$inferSelect;
export type InsertChat = z.infer<typeof insertChatSchema>;

export type Reaction = typeof reactions.$inferSelect;
export type InsertReaction = z.infer<typeof insertReactionSchema>;

export type Session = typeof sessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = z.infer<typeof insertSystemSettingsSchema>;

export type NotificationLog = typeof notificationLogs.$inferSelect;
export type InsertNotificationLog = z.infer<typeof insertNotificationLogSchema>;


export const WS_EVENTS = {
  SYNC_STATE: 'sync_state',
  CHAT_MESSAGE: 'chat_message',
  VOTE_UPDATE: 'vote_update',
  SUBMIT_CHAT: 'submit_chat',
  SUBMIT_VOTE: 'submit_vote',
  SUBMIT_REACTION: 'submit_reaction',
  REACTION_RECEIVED: 'reaction_received',
  SESSION_STATUS: 'session_status'
} as const;

export type WsMessage<T = unknown> = {
  type: keyof typeof WS_EVENTS;
  payload: T;
};

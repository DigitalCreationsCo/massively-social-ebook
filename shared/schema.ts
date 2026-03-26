import { pgTable, text, serial, timestamp, integer, jsonb, boolean, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

const vector = (name: string, { dimensions }: { dimensions: number }) =>
  customType<{ data: number[] }>({
    dataType: () => `vector(${dimensions})`,
  })(name);

// Channels table - stores channel metadata
export const channels = pgTable("channels", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertChannelSchema = createInsertSchema(channels).omit({ id: true, createdAt: true });
export type Channel = typeof channels.$inferSelect;
export type InsertChannel = z.infer<typeof insertChannelSchema>;

export const lore = pgTable("lore", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  content: text("content").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const blocks = pgTable("blocks", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  title: text("title"),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  optionA: jsonb("option_a"),
  optionB: jsonb("option_b"),
  isNotable: boolean("is_notable").default(false).notNull(),
  embedding: vector("embedding", { dimensions: 768 }),
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
  sessionId: integer("session_id"),
  createdAt: timestamp("created_at").defaultNow(),
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
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  scheduledStart: timestamp("scheduled_start").notNull(),
  scheduledEnd: timestamp("scheduled_end").notNull(),
  status: text("status").notNull().default('scheduled'),
  scheduledDays: text("scheduled_days").array(),
  scheduledTime: text("scheduled_time"),
  intervalEnabled: boolean("interval_enabled").notNull().default(false),
  timezone: text("timezone").notNull().default('UTC'),
  nextRunAt: timestamp("next_run_at"),
  notifyCount: integer("notify_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").unique(),
  pushToken: text("push_token"),
  isBanned: boolean("is_banned").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const notificationLogs = pgTable("notification_logs", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // '5_min_warning', 'weekly_brief'
  targetId: text("target_id").notNull(), // session_id or user_id
  sentAt: timestamp("sent_at").defaultNow(),
  status: text("status").notNull(), // 'sent', 'failed', 'skipped'
});


export const insertBlockSchema = createInsertSchema(blocks).omit({ id: true, createdAt: true, embedding: true });
export const insertLoreSchema = createInsertSchema(lore).omit({ id: true, createdAt: true });
export const insertVoteSchema = createInsertSchema(votes).omit({ id: true, createdAt: true });
export const insertChatSchema = createInsertSchema(chat).omit({ id: true, createdAt: true });
export const insertReactionSchema = createInsertSchema(reactions).omit({ id: true, createdAt: true });
export const insertSessionSchema = createInsertSchema(sessions).omit({ 
  id: true, 
  createdAt: true, 
  status: true,
  notifyCount: true,
  nextRunAt: true
});
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertSystemSettingsSchema = createInsertSchema(systemSettings).omit({ updatedAt: true });
export const insertNotificationLogSchema = createInsertSchema(notificationLogs).omit({ id: true, sentAt: true });


export type Block = typeof blocks.$inferSelect;
export type InsertBlock = z.infer<typeof insertBlockSchema>;

export type Lore = typeof lore.$inferSelect;
export type InsertLore = z.infer<typeof insertLoreSchema>;

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

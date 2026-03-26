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

// Schedules table - recurrence rules for sessions
export const schedules = pgTable("schedules", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.channelId, { onDelete: "cascade" }),
  scheduledDays: text("scheduled_days").array(),   // e.g. ['monday','wednesday','friday']
  scheduledTime: text("scheduled_time"),           // e.g. '14:30' (24h, local to timezone)
  intervalEnabled: boolean("interval_enabled").notNull().default(false),
  timezone: text("timezone").notNull().default("UTC"),
  nextRunAt: timestamp("next_run_at"),             // computed by scheduler, updated after each spawn
  createdAt: timestamp("created_at").defaultNow(),
});

// Custom Zod schema for schedules with validations
const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type ScheduleDay = typeof validDays[number];

export const insertScheduleSchema = createInsertSchema(schedules, {
  scheduledDays: z.array(z.enum(validDays)).optional(),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/, "Must be valid 24h time (HH:MM)").optional(),
}).omit({
  id: true,
  createdAt: true,
  nextRunAt: true,
});
export type Schedule = typeof schedules.$inferSelect;
export type InsertSchedule = z.infer<typeof insertScheduleSchema>;

// Session status type
export type SessionStatus = 'scheduled' | 'active' | 'completed' | 'cancelled';

// Sessions table - individual session occurrences
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.channelId, { onDelete: "cascade" }),
  scheduleId: integer("schedule_id")
    .references(() => schedules.id, { onDelete: "set null" }), // nullable - one-off sessions have no schedule
  title: text("title").notNull(),
  description: text("description"),
  scheduledStart: timestamp("scheduled_start").notNull(),
  scheduledEnd: timestamp("scheduled_end").notNull(),
  status: text("status").notNull().default('scheduled'), // SessionStatus
  notifyCount: integer("notify_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSessionSchema = createInsertSchema(sessions).omit({
  id: true,
  createdAt: true,
  status: true,
  notifyCount: true,
});
export type Session = typeof sessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;

// Lore table
export const lore = pgTable("lore", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.channelId, { onDelete: "cascade" }),
  content: text("content").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLoreSchema = createInsertSchema(lore).omit({ id: true, createdAt: true });
export type Lore = typeof lore.$inferSelect;
export type InsertLore = z.infer<typeof insertLoreSchema>;

// Blocks table - narrative blocks within a session
export const blocks = pgTable("blocks", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.channelId, { onDelete: "cascade" }),
  sessionId: integer("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  title: text("title"),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  optionA: jsonb("option_a"),
  optionB: jsonb("option_b"),
  isNotable: boolean("is_notable").default(false).notNull(),
  embedding: vector("embedding", { dimensions: 768 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBlockSchema = createInsertSchema(blocks).omit({ id: true, createdAt: true, embedding: true });
export type Block = typeof blocks.$inferSelect;
export type InsertBlock = z.infer<typeof insertBlockSchema>;

// Votes table
export const votes = pgTable("votes", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.channelId, { onDelete: "cascade" }),
  sessionId: integer("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  blockId: integer("block_id")
    .notNull()
    .references(() => blocks.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  choice: text("choice").notNull(), // 'A' or 'B'
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertVoteSchema = createInsertSchema(votes).omit({ id: true, createdAt: true });
export type Vote = typeof votes.$inferSelect;
export type InsertVote = z.infer<typeof insertVoteSchema>;

// Chat table
export const chat = pgTable("chat", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.channelId, { onDelete: "cascade" }),
  sessionId: integer("session_id")
    .references(() => sessions.id, { onDelete: "set null" }), // nullable - chat may exist outside sessions
  username: text("username").notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertChatSchema = createInsertSchema(chat).omit({ id: true, createdAt: true });
export type ChatMessage = typeof chat.$inferSelect;
export type InsertChat = z.infer<typeof insertChatSchema>;

// Reactions table
export const reactions = pgTable("reactions", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.channelId, { onDelete: "cascade" }),
  sessionId: integer("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  blockId: integer("block_id")
    .notNull()
    .references(() => blocks.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  emoji: text("emoji").notNull(),
  paragraphIndex: integer("paragraph_index").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertReactionSchema = createInsertSchema(reactions).omit({ id: true, createdAt: true });
export type Reaction = typeof reactions.$inferSelect;
export type InsertReaction = z.infer<typeof insertReactionSchema>;

// Users table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").unique(),
  pushToken: text("push_token"),
  isBanned: boolean("is_banned").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

// System Settings table
export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSystemSettingsSchema = createInsertSchema(systemSettings).omit({ updatedAt: true });
export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = z.infer<typeof insertSystemSettingsSchema>;

// Notification target type for disambiguation
export type NotificationTargetType = 'session' | 'user' | 'schedule';

// Notification Logs table
export const notificationLogs = pgTable("notification_logs", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // '5_min_warning', 'session_started', 'session_ended', 'weekly_brief'
  targetType: text("target_type").notNull().default('session'), // 'session' | 'user' | 'schedule'
  targetId: text("target_id").notNull(),
  sentAt: timestamp("sent_at").defaultNow(),
  status: text("status").notNull(), // 'sent', 'failed', 'skipped'
  metadata: jsonb("metadata"), // optional: push payload, error message, etc.
});

export const insertNotificationLogSchema = createInsertSchema(notificationLogs).omit({ id: true, sentAt: true });
export type NotificationLog = typeof notificationLogs.$inferSelect;
export type InsertNotificationLog = z.infer<typeof insertNotificationLogSchema>;

// ─── Composed Types ───────────────────────────────────────────────────────────

/** Session with its parent schedule (if any) */
export type SessionWithSchedule = Session & {
  schedule: Schedule | null;
};

/** Block with its parent session */
export type BlockWithSession = Block & {
  session: Session;
};

// ─── WebSocket Events ────────────────────────────────────────────────────────

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

import { pgTable, text, serial, timestamp, integer, jsonb, boolean, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import type { TitleConfig } from "./title";

const vector = (name: string, { dimensions }: { dimensions: number; }) =>
  customType<{ data: number[]; }>({
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

export type Channel = typeof channels.$inferSelect;
export const InsertChannel = createInsertSchema(channels);
export type InsertChannel = z.infer<typeof InsertChannel>;

// Schedules table - recurrence rules for sessions
export const schedules = pgTable("schedules", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.channelId, { onUpdate: 'cascade', onDelete: "cascade" }),
  scheduledDays: text("scheduled_days").array(),   // e.g. ['monday','wednesday','friday']
  scheduledTime: text("scheduled_time"),           // e.g. '14:30' (24h, local to timezone)
  intervalEnabled: boolean("interval_enabled").notNull().default(false),
  timezone: text("timezone").notNull().default("UTC"),
  nextRunAt: timestamp("next_run_at"),             // computed by scheduler, updated after each spawn

  // ── Title composition ──────────────────────────────────────────────────
  //
  // titleConfig: full TitleConfig object (see title.ts).
  //   Stored as JSONB so format, programName, labels, templates, etc. can
  //   all live here without extra columns. Null = legacy plain-date fallback.
  //
  // sessionCount: the total number of sessions ever spawned by this schedule.
  //   Incremented atomically at spawn time. Used to derive seasonNumber and
  //   episodeNumber for each new session without a full table scan.
  titleConfig: jsonb("title_config").$type<TitleConfig>(),
  sessionCount: integer("session_count").notNull().default(0),

  createdAt: timestamp("created_at").defaultNow(),
});

// Custom Zod schema for schedules with validations
const validDays = [ 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday' ] as const;
export type ScheduleDay = typeof validDays[ number ];

// Zod schema for TitleConfig (mirrors title.ts types for runtime validation)
const titleFormatEnum = z.enum([ 'numbered', 'numbered_subtitle', 'in_world', 'season_episode' ]);
const numberSourceEnum = z.enum([ 'episode', 'absolute', 'day_of_month' ]);

export const titleConfigSchema = z.object({
  format: titleFormatEnum,
  programName: z.string().min(1),
  numberSource: numberSourceEnum.optional(),
  sessionLabel: z.string().optional(),
  subtitle: z.string().optional(),
  inWorldTemplate: z.string().optional(),
  inWorldMode: z.enum([ 'countup', 'countdown' ]).optional(),
  inWorldTotal: z.number().int().positive().optional(),
  seasonSize: z.number().int().min(1).default(30).optional(),
  showSeason: z.boolean().optional(),
  seasonLabel: z.string().optional(),
}).refine(
  (c) => c.format !== 'in_world' || !!c.inWorldTemplate,
  { message: "inWorldTemplate is required when format is 'in_world'", path: [ 'inWorldTemplate' ] }
).refine(
  (c) => c.inWorldMode !== 'countdown' || !!c.inWorldTotal,
  { message: "inWorldTotal is required when inWorldMode is 'countdown'", path: [ 'inWorldTotal' ] }
);

export const insertScheduleSchema = createInsertSchema(schedules, {
  scheduledDays: z.array(z.enum(validDays)).optional(),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/, "Must be valid 24h time (HH:MM)").optional(),
  titleConfig: titleConfigSchema.optional(),
}).omit({
  id: true,
  createdAt: true,
  nextRunAt: true,
  sessionCount: true,   // managed exclusively by the scheduler
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
    .references(() => channels.channelId, { onUpdate: 'cascade', onDelete: "cascade" }),
  scheduleId: integer("schedule_id")
    .references(() => schedules.id, { onDelete: "set null" }), // nullable - one-off sessions have no schedule
  title: text("title").notNull(),
  description: text("description"),
  scheduledStart: timestamp("scheduled_start").notNull(),
  scheduledEnd: timestamp("scheduled_end").notNull(),
  status: text("status").notNull().default('scheduled'), // SessionStatus
  notifyCount: integer("notify_count").notNull().default(0),

  // ── Seasonal position ──────────────────────────────────────────────────
  //
  // These three are denormalized from the schedule's sessionCount at spawn
  // time so queries like "all S2 sessions" are cheap index scans.
  //
  // sessionNumber: 1-based total across the schedule's lifetime
  // seasonNumber:  1-based season index  (floor((sessionNumber-1)/seasonSize)+1)
  // episodeNumber: 1-based within season (((sessionNumber-1)%seasonSize)+1)
  //
  // All three are nullable to stay compatible with one-off sessions that
  // have no schedule and no positional context.
  sessionNumber: integer("session_number"),
  seasonNumber: integer("season_number"),
  episodeNumber: integer("episode_number"),

  // ── Per-session subtitle override ──────────────────────────────────────
  //
  // When a schedule uses 'numbered_subtitle' format, this field lets an
  // admin (or a future AI pipeline) set a unique subtitle for each session
  // instead of relying on the static config.subtitle fallback.
  //
  // e.g. "The Confession", "Into the Fog", "Last Call"
  subtitle: text("subtitle"),

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
    .references(() => channels.channelId, { onUpdate: 'cascade', onDelete: "cascade" }),
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
    .references(() => channels.channelId, { onUpdate: 'cascade', onDelete: "cascade" }),
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
    .references(() => channels.channelId, { onUpdate: 'cascade', onDelete: "cascade" }),
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
    .references(() => channels.channelId, { onUpdate: 'cascade', onDelete: "cascade" }),
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
    .references(() => channels.channelId, { onUpdate: 'cascade', onDelete: "cascade" }),
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

// ─── Channel State table ──────────────────────────────────────────────────────
//
// Persists the game loop's runtime state to the database so that a process
// restart (deploy, crash, scale-down) does not lose a session mid-flight.
//
// The game loop reads this row at the top of every tick and writes it back
// after any phase transition. The `processingLockedUntil` column acts as a
// distributed mutex: the loop does an atomic UPDATE … WHERE
// processingLockedUntil < NOW() before doing any state-mutating work, so
// that multiple instances can run the ticker without stepping on each other.
//
// Column notes:
//   currentPhase         — 'reading' | 'voting' | 'resolution'
//   phaseEndsAt          — wall-clock time when the current phase expires
//   decisionEndsAt       — wall-clock time when the next vote begins
//   initialTimeToDecision — snapshot taken at phase-start, sent to clients
//                          so they can render a "time until next vote" bar
//   turnsToNextChoice    — narrative turns remaining before entering voting
//   currentBlockId       — FK to the block currently being displayed
//   activeSessionId      — FK to the running session (NULL = no session)
//   processingLockedUntil — advisory lock expiry; see tryAcquireGameLock
export const channelStates = pgTable("channel_states", {
  channelId: text("channel_id").primaryKey()
    .references(() => channels.channelId, { onUpdate: 'cascade', onDelete: "cascade" }),
  currentPhase: text("current_phase").notNull().default('reading'),
  phaseEndsAt: timestamp("phase_ends_at").notNull(),
  decisionEndsAt: timestamp("decision_ends_at").notNull(),
  initialTimeToDecision: integer("initial_time_to_decision").notNull().default(0),
  turnsToNextChoice: integer("turns_to_next_choice").notNull().default(3),
  currentBlockId: integer("current_block_id")
    .references(() => blocks.id, { onDelete: "set null" }),
  activeSessionId: integer("active_session_id")
    .references(() => sessions.id, { onDelete: "set null" }),
  processingLockedUntil: timestamp("processing_locked_until"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type ChannelStateRow = typeof channelStates.$inferSelect;
export type InsertChannelState = typeof channelStates.$inferInsert;

// ─── Pending Blocks table ─────────────────────────────────────────────────────
//
// Stores AI-pre-generated story continuations so they survive a restart.
//
// When a new block is displayed, the game loop fires two background tasks —
// one for choice A and one for choice B — that call the AI and write the
// result here. At resolution time the loop does a point lookup by
// (forBlockId, choice) instead of awaiting an in-process Promise.
//
// Rows are deleted after they are consumed (promoted to the blocks table).
// A uniqueness constraint on (forBlockId, choice) prevents duplicate work
// if the pre-generator is accidentally called twice for the same block.
//
// Column notes:
//   forBlockId — the block whose option continuation this pre-generates
//   choice     — 'A' | 'B'
export const pendingBlocks = pgTable("pending_blocks", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull()
    .references(() => channels.channelId, { onUpdate: 'cascade', onDelete: "cascade" }),
  forBlockId: integer("for_block_id").notNull()
    .references(() => blocks.id, { onDelete: "cascade" }),
  choice: text("choice").notNull(), // 'A' | 'B'
  title: text("title").notNull(),
  content: text("content").notNull(),
  imageUrl: text("image_url").notNull(),
  optionA: jsonb("option_a"),
  optionB: jsonb("option_b"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PendingBlock = typeof pendingBlocks.$inferSelect;
export type InsertPendingBlock = typeof pendingBlocks.$inferInsert;

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
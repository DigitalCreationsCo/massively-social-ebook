import { pgTable, serial, text, timestamp, jsonb, unique, boolean, foreignKey, integer, customType } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

const vector = (name: string, { dimensions }: { dimensions: number; }) =>
  customType<{ data: number[]; }>({
    dataType: () => `vector(${dimensions})`,
  })(name);

export const notificationLogs = pgTable("notification_logs", {
	id: serial().primaryKey().notNull(),
	type: text().notNull(),
	targetType: text("target_type").default('session').notNull(),
	targetId: text("target_id").notNull(),
	sentAt: timestamp("sent_at", { mode: 'string' }).defaultNow(),
	status: text().notNull(),
	metadata: jsonb(),
});

export const channels = pgTable("channels", {
	id: serial().primaryKey().notNull(),
	channelId: text("channel_id").notNull(),
	name: text().notNull(),
	description: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	unique("channels_channel_id_unique").on(table.channelId),
]);

export const systemSettings = pgTable("system_settings", {
	key: text().primaryKey().notNull(),
	value: text().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const users = pgTable("users", {
	id: serial().primaryKey().notNull(),
	email: text(),
	pushToken: text("push_token"),
	isBanned: boolean("is_banned").default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	unique("users_email_unique").on(table.email),
]);

export const blocks = pgTable("blocks", {
	id: serial().primaryKey().notNull(),
	channelId: text("channel_id").notNull(),
	sessionId: integer("session_id").notNull(),
	title: text(),
	content: text().notNull(),
	imageUrl: text("image_url"),
	optionA: jsonb("option_a"),
	optionB: jsonb("option_b"),
	isNotable: boolean("is_notable").default(false).notNull(),
	embedding: vector("embedding", { dimensions: 768 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.channelId],
			foreignColumns: [channels.channelId],
			name: "blocks_channel_id_channels_channel_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "blocks_session_id_sessions_id_fk"
		}).onDelete("cascade"),
]);

export const sessions = pgTable("sessions", {
	id: serial().primaryKey().notNull(),
	channelId: text("channel_id").notNull(),
	scheduleId: integer("schedule_id"),
	title: text().notNull(),
	description: text(),
	scheduledStart: timestamp("scheduled_start", { mode: 'string' }).notNull(),
	scheduledEnd: timestamp("scheduled_end", { mode: 'string' }).notNull(),
	status: text().default('scheduled').notNull(),
	notifyCount: integer("notify_count").default(0).notNull(),
	sessionNumber: integer("session_number"),
	seasonNumber: integer("season_number"),
	episodeNumber: integer("episode_number"),
	subtitle: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.channelId],
			foreignColumns: [channels.channelId],
			name: "sessions_channel_id_channels_channel_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.scheduleId],
			foreignColumns: [schedules.id],
			name: "sessions_schedule_id_schedules_id_fk"
		}).onDelete("set null"),
]);

export const chat = pgTable("chat", {
	id: serial().primaryKey().notNull(),
	channelId: text("channel_id").notNull(),
	sessionId: integer("session_id"),
	username: text().notNull(),
	text: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.channelId],
			foreignColumns: [channels.channelId],
			name: "chat_channel_id_channels_channel_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "chat_session_id_sessions_id_fk"
		}).onDelete("set null"),
]);

export const lore = pgTable("lore", {
	id: serial().primaryKey().notNull(),
	channelId: text("channel_id").notNull(),
	content: text().notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.channelId],
			foreignColumns: [channels.channelId],
			name: "lore_channel_id_channels_channel_id_fk"
		}).onDelete("cascade"),
]);

export const reactions = pgTable("reactions", {
	id: serial().primaryKey().notNull(),
	channelId: text("channel_id").notNull(),
	sessionId: integer("session_id").notNull(),
	blockId: integer("block_id").notNull(),
	userId: text("user_id").notNull(),
	emoji: text().notNull(),
	paragraphIndex: integer("paragraph_index").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.blockId],
			foreignColumns: [blocks.id],
			name: "reactions_block_id_blocks_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.channelId],
			foreignColumns: [channels.channelId],
			name: "reactions_channel_id_channels_channel_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "reactions_session_id_sessions_id_fk"
		}).onDelete("cascade"),
]);

export const schedules = pgTable("schedules", {
	id: serial().primaryKey().notNull(),
	channelId: text("channel_id").notNull(),
	scheduledDays: text("scheduled_days").array(),
	scheduledTime: text("scheduled_time"),
	intervalEnabled: boolean("interval_enabled").default(false).notNull(),
	timezone: text().default('UTC').notNull(),
	nextRunAt: timestamp("next_run_at", { mode: 'string' }),
	titleConfig: jsonb("title_config"),
	sessionCount: integer("session_count").default(0).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.channelId],
			foreignColumns: [channels.channelId],
			name: "schedules_channel_id_channels_channel_id_fk"
		}).onDelete("cascade"),
]);

export const votes = pgTable("votes", {
	id: serial().primaryKey().notNull(),
	channelId: text("channel_id").notNull(),
	sessionId: integer("session_id").notNull(),
	blockId: integer("block_id").notNull(),
	userId: text("user_id").notNull(),
	choice: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.blockId],
			foreignColumns: [blocks.id],
			name: "votes_block_id_blocks_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.channelId],
			foreignColumns: [channels.channelId],
			name: "votes_channel_id_channels_channel_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "votes_session_id_sessions_id_fk"
		}).onDelete("cascade"),
]);

export const channelStates = pgTable("channel_states", {
	channelId: text("channel_id").primaryKey().notNull(),
	currentPhase: text("current_phase").default('reading').notNull(),
	phaseEndsAt: timestamp("phase_ends_at", { mode: 'string' }).notNull(),
	decisionEndsAt: timestamp("decision_ends_at", { mode: 'string' }).notNull(),
	initialTimeToDecision: integer("initial_time_to_decision").default(0).notNull(),
	turnsToNextChoice: integer("turns_to_next_choice").default(3).notNull(),
	currentBlockId: integer("current_block_id"),
	activeSessionId: integer("active_session_id"),
	processingLockedUntil: timestamp("processing_locked_until", { mode: 'string' }),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.channelId],
			foreignColumns: [channels.channelId],
			name: "channel_states_channel_id_channels_channel_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.currentBlockId],
			foreignColumns: [blocks.id],
			name: "channel_states_current_block_id_blocks_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.activeSessionId],
			foreignColumns: [sessions.id],
			name: "channel_states_active_session_id_sessions_id_fk"
		}).onDelete("set null"),
]);

export const pendingBlocks = pgTable("pending_blocks", {
	id: serial().primaryKey().notNull(),
	channelId: text("channel_id").notNull(),
	forBlockId: integer("for_block_id").notNull(),
	choice: text().notNull(),
	title: text().notNull(),
	content: text().notNull(),
	imageUrl: text("image_url").notNull(),
	optionA: jsonb("option_a"),
	optionB: jsonb("option_b"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.channelId],
			foreignColumns: [channels.channelId],
			name: "pending_blocks_channel_id_channels_channel_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.forBlockId],
			foreignColumns: [blocks.id],
			name: "pending_blocks_for_block_id_blocks_id_fk"
		}).onDelete("cascade"),
]);

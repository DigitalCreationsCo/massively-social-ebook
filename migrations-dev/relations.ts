import { relations } from "drizzle-orm/relations";
import { blocks, reactions, channels, sessions, schedules, chat, lore, votes } from "./schema";

export const reactionsRelations = relations(reactions, ({one}) => ({
	block: one(blocks, {
		fields: [reactions.blockId],
		references: [blocks.id]
	}),
	channel: one(channels, {
		fields: [reactions.channelId],
		references: [channels.channelId]
	}),
	session: one(sessions, {
		fields: [reactions.sessionId],
		references: [sessions.id]
	}),
}));

export const blocksRelations = relations(blocks, ({one, many}) => ({
	reactions: many(reactions),
	votes: many(votes),
	channel: one(channels, {
		fields: [blocks.channelId],
		references: [channels.channelId]
	}),
	session: one(sessions, {
		fields: [blocks.sessionId],
		references: [sessions.id]
	}),
}));

export const channelsRelations = relations(channels, ({many}) => ({
	reactions: many(reactions),
	schedules: many(schedules),
	chats: many(chat),
	lores: many(lore),
	votes: many(votes),
	blocks: many(blocks),
	sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({one, many}) => ({
	reactions: many(reactions),
	chats: many(chat),
	votes: many(votes),
	blocks: many(blocks),
	channel: one(channels, {
		fields: [sessions.channelId],
		references: [channels.channelId]
	}),
	schedule: one(schedules, {
		fields: [sessions.scheduleId],
		references: [schedules.id]
	}),
}));

export const schedulesRelations = relations(schedules, ({one, many}) => ({
	channel: one(channels, {
		fields: [schedules.channelId],
		references: [channels.channelId]
	}),
	sessions: many(sessions),
}));

export const chatRelations = relations(chat, ({one}) => ({
	channel: one(channels, {
		fields: [chat.channelId],
		references: [channels.channelId]
	}),
	session: one(sessions, {
		fields: [chat.sessionId],
		references: [sessions.id]
	}),
}));

export const loreRelations = relations(lore, ({one}) => ({
	channel: one(channels, {
		fields: [lore.channelId],
		references: [channels.channelId]
	}),
}));

export const votesRelations = relations(votes, ({one}) => ({
	block: one(blocks, {
		fields: [votes.blockId],
		references: [blocks.id]
	}),
	channel: one(channels, {
		fields: [votes.channelId],
		references: [channels.channelId]
	}),
	session: one(sessions, {
		fields: [votes.sessionId],
		references: [sessions.id]
	}),
}));
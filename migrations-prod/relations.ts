import { relations } from "drizzle-orm/relations";
import { channels, blocks, sessions, schedules, chat, lore, reactions, votes } from "./schema";

export const blocksRelations = relations(blocks, ({one, many}) => ({
	channel: one(channels, {
		fields: [blocks.channelId],
		references: [channels.channelId]
	}),
	session: one(sessions, {
		fields: [blocks.sessionId],
		references: [sessions.id]
	}),
	reactions: many(reactions),
	votes: many(votes),
}));

export const channelsRelations = relations(channels, ({many}) => ({
	blocks: many(blocks),
	sessions: many(sessions),
	chats: many(chat),
	lores: many(lore),
	reactions: many(reactions),
	schedules: many(schedules),
	votes: many(votes),
}));

export const sessionsRelations = relations(sessions, ({one, many}) => ({
	blocks: many(blocks),
	channel: one(channels, {
		fields: [sessions.channelId],
		references: [channels.channelId]
	}),
	schedule: one(schedules, {
		fields: [sessions.scheduleId],
		references: [schedules.id]
	}),
	chats: many(chat),
	reactions: many(reactions),
	votes: many(votes),
}));

export const schedulesRelations = relations(schedules, ({one, many}) => ({
	sessions: many(sessions),
	channel: one(channels, {
		fields: [schedules.channelId],
		references: [channels.channelId]
	}),
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
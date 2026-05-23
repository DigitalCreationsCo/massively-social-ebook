import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
    channels: {
        state: r.one.channelStates({
            from: r.channels.channelId,
            to: r.channelStates.channelId,
        }),
        schedules: r.many.schedules(),
        sessions: r.many.sessions(),
        blocks: r.many.blocks(),
        pendingBlocks: r.many.pendingBlocks(),
        lore: r.many.lore(),
        votes: r.many.votes(),
        chats: r.many.chat(),
        reactions: r.many.reactions(),
    },

    schedules: {
        channel: r.one.channels({
            from: r.schedules.channelId,
            to: r.channels.channelId,
        }),
        sessions: r.many.sessions(),
    },

    sessions: {
        channel: r.one.channels({
            from: r.sessions.channelId,
            to: r.channels.channelId,
        }),
        schedule: r.one.schedules({
            from: r.sessions.scheduleId,
            to: r.schedules.id,
        }),
        blocks: r.many.blocks(),
        votes: r.many.votes(),
        chats: r.many.chat(),
        reactions: r.many.reactions(),
    },

    channelStates: {
        channel: r.one.channels({
            from: r.channelStates.channelId,
            to: r.channels.channelId,
        }),
        currentBlock: r.one.blocks({
            from: r.channelStates.currentBlockId,
            to: r.blocks.id,
        }),
        activeSession: r.one.sessions({
            from: r.channelStates.activeSessionId,
            to: r.sessions.id,
        }),
    },

    blocks: {
        channel: r.one.channels({
            from: r.blocks.channelId,
            to: r.channels.channelId,
        }),
        session: r.one.sessions({
            from: r.blocks.sessionId,
            to: r.sessions.id,
        }),
        pendingBlocks: r.many.pendingBlocks(),
        votes: r.many.votes(),
        chats: r.many.chat(),
        reactions: r.many.reactions(),
    },

    pendingBlocks: {
        channel: r.one.channels({
            from: r.pendingBlocks.channelId,
            to: r.channels.channelId,
        }),
        forBlock: r.one.blocks({
            from: r.pendingBlocks.forBlockId,
            to: r.blocks.id,
        }),
    },

    lore: {
        channel: r.one.channels({
            from: r.lore.channelId,
            to: r.channels.channelId,
        }),
    },

    votes: {
        channel: r.one.channels({
            from: r.votes.channelId,
            to: r.channels.channelId,
        }),
        session: r.one.sessions({
            from: r.votes.sessionId,
            to: r.sessions.id,
        }),
        block: r.one.blocks({
            from: r.votes.blockId,
            to: r.blocks.id,
        }),
    },

    chat: {
        channel: r.one.channels({
            from: r.chat.channelId,
            to: r.channels.channelId,
        }),
        session: r.one.sessions({
            from: r.chat.sessionId,
            to: r.sessions.id,
        }),
        block: r.one.blocks({
            from: r.chat.blockId,
            to: r.blocks.id,
        }),
    },

    reactions: {
        channel: r.one.channels({
            from: r.reactions.channelId,
            to: r.channels.channelId,
        }),
        session: r.one.sessions({
            from: r.reactions.sessionId,
            to: r.sessions.id,
        }),
        block: r.one.blocks({
            from: r.reactions.blockId,
            to: r.blocks.id,
        }),
    },
}));
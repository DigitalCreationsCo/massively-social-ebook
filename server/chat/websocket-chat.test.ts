// server/websocket-chat.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleChatSubmit } from './websocket-handler'; // Assuming handler extraction
import { db } from '../db';
import { chat } from '../db/schema';

vi.mock('../db', () => ({
    db: {
        insert: vi.fn(() => ({
            values: vi.fn().mockResolvedValue([{ id: 1 }])
        })),
        query: {
            channel_states: { findFirst: vi.fn() }
        }
    }
}));

describe('WebSocket: SUBMIT_CHAT', () => {
    it('attaches the current_block_id from channel_states to new messages', async () => {
        const mockChannelState = { current_block_id: 42, active_session_id: 5 };
        vi.mocked(db.query.channel_states.findFirst).mockResolvedValueOnce(mockChannelState);

        const payload = { channelId: 'scifi', username: 'Player1', text: 'Woah!' };

        await handleChatSubmit(payload);

        expect(db.query.channel_states.findFirst).toHaveBeenCalledWith({
            where: expect.anything()
        });

        expect(db.insert).toHaveBeenCalled();
        // The specific mock chaining requires us to check if the insertion values contained block_id
        const valuesMock = vi.mocked(db.insert(chat).values);
        expect(valuesMock).toHaveBeenCalledWith(
            expect.objectContaining({
                channel_id: 'scifi',
                username: 'Player1',
                text: 'Woah!',
                block_id: 42, // Verifies correct linkage
                session_id: 5
            })
        );
    });
});
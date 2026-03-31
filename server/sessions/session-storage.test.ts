import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseStorage } from '../storage';
import { db } from '../db';

vi.mock('../db', () => {
    const mockChainDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        execute: vi.fn(),
    };
    return { db: mockChainDb };
});

describe('Database Storage Operations (Sessions)', () => {
    const storageDb = new DatabaseStorage();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Window Query Execution: getSessionsInWindow', () => {
        it('fetches sessions strictly within the provided datetime bounds', async () => {
            const dateStartMock = new Date('2026-03-01T00:00:00Z');
            const dateEndMock = new Date('2026-03-07T00:00:00Z');
            const arrSessionsValidMock = [
                { id: 1, channelId: 'scifi', status: 'scheduled', scheduledStart: new Date('2026-03-02T12:00:00Z') },
            ];

            (db.orderBy as any).mockResolvedValue(arrSessionsValidMock);

            const arrResults = await storageDb.getSessionsInWindow('scifi', dateStartMock, dateEndMock);
            expect(arrResults).toEqual(arrSessionsValidMock);
            expect(db.select).toHaveBeenCalled();
            expect(db.where).toHaveBeenCalled();
        });

        it('traps and bubbles database faults during fetch operations', async () => {
            const dateStartMock = new Date();
            const dateEndMock = new Date();
            const errorDbMock = new Error('Connection lost');

            (db.select as any).mockImplementation(() => { throw errorDbMock; });

            await expect(storageDb.getSessionsInWindow('scifi', dateStartMock, dateEndMock))
                .rejects.toThrow('Connection lost');
        });
    });
});
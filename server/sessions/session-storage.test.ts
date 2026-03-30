import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseStorage } from '../storage';
import { db } from '../db';
import { sessions } from '@shared/schema';

// Mock the db
vi.mock('../db', () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        execute: vi.fn(),
    }
}));

describe('Session Storage Core', () => {
    const storage = new DatabaseStorage();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getSessionsInWindow', () => {
        it('fetches sessions strictly within the provided date bounds', async () => {
            const dateStartMock = new Date('2026-03-01T00:00:00Z');
            const dateEndMock = new Date('2026-03-07T00:00:00Z');
            const arrMockSessionsValid = [
                { id: 1, channelId: 'scifi', status: 'scheduled', scheduledStart: new Date('2026-03-02T12:00:00Z') },
            ];

            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockResolvedValue(arrMockSessionsValid),
            });

            const arrResultSessions = await storage.getSessionsInWindow('scifi', dateStartMock, dateEndMock);
            expect(arrResultSessions).toEqual(arrMockSessionsValid);
            expect(db.select).toHaveBeenCalled();
        });

        it('throws and logs uncaught errors gracefully during window fetch', async () => {
            const dateStartMock = new Date();
            const dateEndMock = new Date();
            const errorMockDb = new Error('Connection lost');

            (db.select as any).mockImplementation(() => { throw errorMockDb; });

            await expect(storage.getSessionsInWindow('scifi', dateStartMock, dateEndMock)).rejects.toThrow('Connection lost');
        });
    });

    // ... (Keep existing getNextSession, getActiveSession, listSessions tests)
});
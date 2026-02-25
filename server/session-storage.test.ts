import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseStorage } from './storage';
import { db } from './db';
import { sessions } from '@shared/schema';

// Mock the db
vi.mock('./db', () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        execute: vi.fn(),
    }
}));

describe('Session Storage', () => {
    const storage = new DatabaseStorage();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getNextSession', () => {
        it('returns the next scheduled session for a channel', async () => {
            const mockSession = {
                id: 1,
                channelId: 'scifi',
                status: 'scheduled',
                scheduledStart: new Date('2026-03-01T12:00:00Z')
            };

            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([ mockSession ]),
            });

            const result = await storage.getNextSession('scifi');
            expect(result).toEqual(mockSession);
        });

        it('returns null if no scheduled sessions found', async () => {
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
            });

            const result = await storage.getNextSession('scifi');
            expect(result).toBeUndefined();
        });
    });

    describe('getActiveSession', () => {
        it('returns the current active session for a channel', async () => {
            const mockSession = { id: 2, channelId: 'mystery', status: 'active' };

            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([ mockSession ]),
            });

            const result = await storage.getActiveSession('mystery');
            expect(result).toEqual(mockSession);
        });
    });

    describe('createSession', () => {
        it('inserts a new session and returns it', async () => {
            const newSessionData = {
                channelId: 'scifi',
                title: 'New Event',
                scheduledStart: new Date(),
                scheduledEnd: new Date(),
            };
            const createdSession = { id: 10, ...newSessionData, status: 'scheduled' };

            (db.insert as any).mockReturnValue({
                values: vi.fn().mockReturnThis(),
                returning: vi.fn().mockResolvedValue([ createdSession ]),
            });

            const result = await storage.createSession(newSessionData as any);
            expect(result).toEqual(createdSession);
            expect(db.insert).toHaveBeenCalledWith(sessions);
        });
    });

    describe('updateSessionStatus', () => {
        it('updates the status of a session', async () => {
            const updatedSession = { id: 1, status: 'active' };

            (db.update as any).mockReturnValue({
                set: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                returning: vi.fn().mockResolvedValue([ updatedSession ]),
            });

            const result = await storage.updateSessionStatus(1, 'active');
            expect(result).toEqual(updatedSession);
        });
    });

    describe('listSessions', () => {
        it('lists sessions with optional filtering', async () => {
            const mockSessions = [
                { id: 1, channelId: 'scifi', status: 'scheduled' },
                { id: 2, channelId: 'mystery', status: 'active' }
            ];

            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockResolvedValue(mockSessions),
            });

            const result = await storage.listSessions();
            expect(result).toEqual(mockSessions);
        });
    });

    describe('cancelSession', () => {
        it('sets session status to cancelled', async () => {
            const cancelledSession = { id: 5, status: 'cancelled' };

            (db.update as any).mockReturnValue({
                set: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                returning: vi.fn().mockResolvedValue([ cancelledSession ]),
            });

            const result = await storage.cancelSession(5);
            expect(result).toEqual(cancelledSession);
        });
    });
});

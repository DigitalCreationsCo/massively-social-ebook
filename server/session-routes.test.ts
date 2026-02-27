import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerRoutes } from './routes';
import { storage } from './storage';
import { createServer } from 'http';

// Mock everything needed for routes.ts initialization
vi.mock('./storage', () => ({
    storage: {
        getCurrentBlock: vi.fn(),
        createBlock: vi.fn(),
        getRecentChat: vi.fn(),
        getActiveSession: vi.fn(),
        getNextSession: vi.fn(),
        listSessions: vi.fn(),
        createSession: vi.fn(),
        cancelSession: vi.fn(),
        getRandomImage: vi.fn(),
        getUserByEmail: vi.fn(),
        updateUserPushToken: vi.fn(),
        createUser: vi.fn(),
    },
}));

vi.mock('./ai', () => ({
    generateStoryBlock: vi.fn(),
    generateStoryImage: vi.fn(),
}));

const mockedStorage = vi.mocked(storage);

describe('Session REST API', () => {
    let app: express.Express;

    beforeEach(async () => {
        vi.clearAllMocks();
        app = express();
        app.use(express.json());
        
        // Mock getCurrentBlock to avoid seeding loops during registerRoutes
        mockedStorage.getCurrentBlock.mockResolvedValue({ id: 1 } as any);
        mockedStorage.getActiveSession.mockResolvedValue(undefined);
        
        const server = createServer(app);
        await registerRoutes(server, app);
    });

    describe('GET /api/sessions/next', () => {
        it('returns 200 with the next session if found', async () => {
            const mockSession = { id: 1, title: 'Next Session' };
            mockedStorage.getNextSession.mockResolvedValue(mockSession as any);

            const res = await request(app).get('/api/sessions/next?channelId=scifi');
            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockSession);
        });

        it('returns 200 with null if no session found', async () => {
            mockedStorage.getNextSession.mockResolvedValue(null as any);
            const res = await request(app).get('/api/sessions/next?channelId=mystery');
            expect(res.status).toBe(200);
            expect(res.body).toBeNull();
        });
    });

    describe('GET /api/sessions/:id/ics', () => {
        it('returns 200 with ICS file for valid session', async () => {
            const mockSession = {
                id: 42,
                title: 'Test',
                description: 'Test Description',
                scheduledStart: new Date(),
                scheduledEnd: new Date()
            };
            mockedStorage.listSessions.mockResolvedValue([mockSession] as any);

            const res = await request(app).get('/api/sessions/42/ics');

            expect(res.status).toBe(200);
            expect(res.header['content-type']).toBe('text/calendar; charset=utf-8');
            expect(res.header['content-disposition']).toContain('attachment; filename="session-42.ics"');
            expect(res.text).toContain('BEGIN:VCALENDAR');
            expect(res.text).toContain('SUMMARY:The 25th Chapter: Test');
        });

        it('returns 404 for non-existent session', async () => {
            mockedStorage.listSessions.mockResolvedValue([]);
            const res = await request(app).get('/api/sessions/999/ics');
            expect(res.status).toBe(404);
        });
    });

    describe('POST /api/sessions/reminder', () => {
        it('returns 200 and persists user', async () => {
            const mockSession = {
                id: 42,
                title: 'Test',
                scheduledStart: new Date(),
                scheduledEnd: new Date()
            };
            mockedStorage.listSessions.mockResolvedValue([mockSession] as any);
            mockedStorage.getUserByEmail.mockResolvedValue(undefined);
            mockedStorage.createUser.mockResolvedValue({ id: 1, email: 'test@example.com' } as any);

            const res = await request(app)
                .post('/api/sessions/reminder')
                .send({ sessionId: 42, email: 'test@example.com' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockedStorage.createUser).toHaveBeenCalledWith({ email: 'test@example.com' });
        });

        it('returns 200 and persists user even if session is not found (Global Interest)', async () => {
            mockedStorage.listSessions.mockResolvedValue([]);
            mockedStorage.getUserByEmail.mockResolvedValue(undefined);
            mockedStorage.createUser.mockResolvedValue({ id: 1, email: 'test@example.com' } as any);

            const res = await request(app)
                .post('/api/sessions/reminder')
                .send({ sessionId: 999, email: 'test@example.com' });
            
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockedStorage.createUser).toHaveBeenCalledWith({ email: 'test@example.com' });
        });
    });

    describe('Admin API', () => {
        it('GET /api/admin/sessions lists all sessions', async () => {
            mockedStorage.listSessions.mockResolvedValue([{ id: 1 }] as any);
            const res = await request(app).get('/api/admin/sessions');
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
        });

        it('POST /api/admin/sessions creates a session', async () => {
            const mockSession = { id: 5, title: 'New' };
            mockedStorage.createSession.mockResolvedValue(mockSession as any);

            const res = await request(app)
                .post('/api/admin/sessions')
                .send({ 
                    channelId: 'scifi', 
                    title: 'New', 
                    scheduledStart: '2026-03-01', 
                    scheduledEnd: '2026-03-02' 
                });

            expect(res.status).toBe(201);
            expect(res.body).toEqual(mockSession);
        });

        it('PATCH /api/admin/sessions/:id/cancel cancels a session', async () => {
            mockedStorage.cancelSession.mockResolvedValue({ id: 1, status: 'cancelled' } as any);
            const res = await request(app).patch('/api/admin/sessions/1/cancel');
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('cancelled');
        });
    });
});

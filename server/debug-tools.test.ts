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
        getChannelState: vi.fn(),
        upsertChannelState: vi.fn(),
        tryAcquireGameLock: vi.fn(),
        releaseGameLock: vi.fn(),
        updateSessionScheduledEnd: vi.fn(),
        getChannel: vi.fn(),
        updateSessionStatus: vi.fn(),
    },
}));

vi.mock('./ai', () => ({
    generateStoryBlock: vi.fn(),
}));

vi.mock('./image-uploader', () => ({
    generateAndUploadStoryImage: vi.fn(),
}));

const mockedStorage = vi.mocked(storage);

describe('Debug Tools API', () => {
    let app: express.Express;
    const ADMIN_TOKEN = 'test-admin-token';

    beforeEach(async () => {
        vi.clearAllMocks();
        process.env.ADMIN_TOKEN = ADMIN_TOKEN;
        app = express();
        app.use(express.json());
        
        // Mock storage to avoid initialization errors
        mockedStorage.getCurrentBlock.mockResolvedValue({ id: 1 } as any);
        mockedStorage.getActiveSession.mockResolvedValue(undefined);
        
        const server = createServer(app);
        await registerRoutes(server, app);
    });

    describe('Security', () => {
        it('rejects requests without admin token', async () => {
            const res = await request(app).post('/api/debug/sessions/skip').send({ channelId: 'mystery' });
            expect(res.status).toBe(401);
        });

        it('rejects requests with invalid admin token', async () => {
            const res = await request(app)
                .post('/api/debug/sessions/skip')
                .set('x-admin-token', 'wrong-token')
                .send({ channelId: 'mystery' });
            expect(res.status).toBe(401);
        });

        it('rejects requests in production environment', async () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            try {
                const res = await request(app)
                    .post('/api/debug/sessions/skip')
                    .set('x-admin-token', ADMIN_TOKEN)
                    .send({ channelId: 'mystery' });
                expect(res.status).toBe(403);
                expect(res.body.message).toContain('disabled in production');
            } finally {
                process.env.NODE_ENV = originalEnv;
            }
        });
    });

    describe('Endpoints', () => {
        it('POST /api/debug/sessions/start starts a session', async () => {
            mockedStorage.getNextSession.mockResolvedValue({ id: 123, scheduledStart: new Date(), scheduledEnd: new Date() } as any);
            mockedStorage.updateSessionStatus.mockResolvedValue({ id: 123, status: 'active' } as any);
            mockedStorage.getChannel.mockResolvedValue({ channelId: 'm2w4k' } as any);

            const res = await request(app)
                .post('/api/debug/sessions/start')
                .set('x-admin-token', ADMIN_TOKEN)
                .send({ channelId: 'm2w4k' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockedStorage.updateSessionStatus).toHaveBeenCalledWith(123, 'active');
        });

        it('POST /api/debug/sessions/skip triggers phase skip', async () => {
            // Mock active session
            mockedStorage.getActiveSession.mockResolvedValue({ id: 123, scheduledEnd: new Date(Date.now() + 10000) } as any);
            mockedStorage.getChannelState.mockResolvedValue({ activeSessionId: 123 } as any);
            
            // Re-register to pick up active session
            const app2 = express();
            app2.use(express.json());
            await registerRoutes(createServer(app2), app2);

            const res = await request(app2)
                .post('/api/debug/sessions/skip')
                .set('x-admin-token', ADMIN_TOKEN)
                .send({ channelId: 'm2w4k' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('POST /api/debug/sessions/resolve triggers resolution', async () => {
            mockedStorage.getActiveSession.mockResolvedValue({ id: 123, scheduledEnd: new Date() } as any);
            mockedStorage.getChannelState.mockResolvedValue({ activeSessionId: 123 } as any);
            
            const app3 = express();
            app3.use(express.json());
            await registerRoutes(createServer(app3), app3);

            const res = await request(app3)
                .post('/api/debug/sessions/resolve')
                .set('x-admin-token', ADMIN_TOKEN)
                .send({ channelId: 'm2w4k' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });
});

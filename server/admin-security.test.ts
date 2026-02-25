import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerRoutes } from './routes';
import { createServer } from 'http';

// Mock storage and AI to avoid side effects
vi.mock('./storage', () => ({
    storage: {
        getActiveSession: vi.fn(),
        getNextSession: vi.fn(),
        listSessions: vi.fn(),
        getCurrentBlock: vi.fn(),
        getRecentChat: vi.fn(),
    },
}));

vi.mock('./ai', () => ({
    generateStoryBlock: vi.fn(),
    generateStoryImage: vi.fn(),
}));

describe('Admin Security Middleware', () => {
    let app: express.Express;
    const ADMIN_TOKEN = 'test-admin-token';

    beforeEach(async () => {
        process.env.ADMIN_TOKEN = ADMIN_TOKEN;
        process.env.NODE_ENV = 'production';
        app = express();
        app.use(express.json());
        const server = createServer(app);
        await registerRoutes(server, app);
    });

    it('blocks access to admin endpoints without a token', async () => {
        const response = await request(app).get('/api/admin/sessions');
        expect(response.status).toBe(401);
        expect(response.body.message).toContain('Admin token required');
    });

    it('allows access to admin endpoints with a valid x-admin-token header', async () => {
        const response = await request(app)
            .get('/api/admin/sessions')
            .set('x-admin-token', ADMIN_TOKEN);
        expect(response.status).not.toBe(401);
    });

    it('allows access to admin endpoints with a valid token query param', async () => {
        const response = await request(app)
            .get(`/api/admin/sessions?token=${ADMIN_TOKEN}`);
        expect(response.status).not.toBe(401);
    });

    it('blocks access to debug endpoint without a token', async () => {
        const response = await request(app).post('/api/debug/sessions/resolve');
        expect(response.status).toBe(401);
    });
});

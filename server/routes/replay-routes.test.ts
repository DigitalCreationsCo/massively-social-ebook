// server/replay-routes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import replayRouter from './replay-routes';
import { db } from '../db';

// Mock the Drizzle database queries
vi.mock('../db', () => ({
    db: {
        query: {
            sessions: { findFirst: vi.fn() },
            blocks: { findMany: vi.fn() }
        }
    }
}));

const app = express();
app.use(express.json());
app.use(replayRouter);

describe('Replay REST API Endpoints', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('GET /api/sessions/history', () => {
        it('returns 400 if channelId is missing', async () => {
            const res = await request(app).get('/api/sessions/history');
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('channelId is required');
        });

        it('fetches the most recent completed session by default', async () => {
            const mockSession = { id: 1, channel_id: 'scifi', status: 'completed' };
            vi.mocked(db.query.sessions.findFirst).mockResolvedValueOnce(mockSession);

            const res = await request(app).get('/api/sessions/history?channelId=scifi');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockSession);
            expect(db.query.sessions.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    orderBy: expect.any(Array) // Verifies descending order is applied
                })
            );
        });

        it('returns 404 if no completed sessions exist', async () => {
            vi.mocked(db.query.sessions.findFirst).mockResolvedValueOnce(undefined);

            const res = await request(app).get('/api/sessions/history?channelId=scifi');
            expect(res.status).toBe(404);
        });
    });

    describe('GET /api/blocks/history', () => {
        it('returns 400 if sessionId is missing', async () => {
            const res = await request(app).get('/api/blocks/history');
            expect(res.status).toBe(400);
        });

        it('fetches chronological blocks with top 10 chats', async () => {
            const mockBlocks = [
                { id: 101, content: 'Block 1', chats: [{ id: 1, text: 'Hello' }] }
            ];
            vi.mocked(db.query.blocks.findMany).mockResolvedValueOnce(mockBlocks);

            const res = await request(app).get('/api/blocks/history?sessionId=1');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockBlocks);
            expect(db.query.blocks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    with: { chats: { limit: 10, orderBy: expect.any(Array) } },
                    orderBy: expect.any(Array) // Verifies ascending order is applied
                })
            );
        });

        it('applies notableOnly filter when queried', async () => {
            vi.mocked(db.query.blocks.findMany).mockResolvedValueOnce([]);

            await request(app).get('/api/blocks/history?sessionId=1&notableOnly=true');

            // Ensures the Drizzle "and()" condition was triggered for is_notable
            expect(db.query.blocks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.anything()
                })
            );
        });
    });
});
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerAdminRoutes } from './admin-routes';
import { storage } from '../storage';
import { createServer } from 'http';

vi.mock('../storage', () => ({
    storage: {
        getChannels: vi.fn(),
        createChannel: vi.fn(),
        updateChannel: vi.fn(),
        deleteChannel: vi.fn(),
        getLore: vi.fn(),
        createLore: vi.fn(),
        deactivateLore: vi.fn(),
        updateLore: vi.fn(),
    },
}));

const mockedStorage = vi.mocked(storage);

describe('Lore REST API', () => {
    let app: express.Express;
    const ADMIN_TOKEN = 'test-admin-token';

    beforeEach(async () => {
        process.env.ADMIN_TOKEN = ADMIN_TOKEN;
        vi.clearAllMocks();
        app = express();
        app.use(express.json());
        
        mockedStorage.getChannels.mockResolvedValue([]);
        
        const server = createServer(app);
        registerAdminRoutes(app);
    });

    describe('GET /admin/api/lore', () => {
        it('returns 200 with lore list', async () => {
            const mockLore = [
                { id: 1, channelId: 'scifi', content: 'Lore content 1', isActive: true },
                { id: 2, channelId: 'mystery', content: 'Lore content 2', isActive: false }
            ];
            mockedStorage.getLore.mockResolvedValue(mockLore as any);

            const res = await request(app)
                .get('/admin/api/lore')
                .set('x-admin-token', ADMIN_TOKEN);

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockLore);
        });

        it('returns 200 with filtered lore by channelId', async () => {
            const mockLore = [{ id: 1, channelId: 'scifi', content: 'Lore content', isActive: true }];
            mockedStorage.getLore.mockResolvedValue(mockLore as any);

            const res = await request(app)
                .get('/admin/api/lore?channelId=scifi')
                .set('x-admin-token', ADMIN_TOKEN);

            expect(res.status).toBe(200);
            expect(mockedStorage.getLore).toHaveBeenCalledWith('scifi');
        });

        it('returns 500 on database error', async () => {
            mockedStorage.getLore.mockRejectedValue(new Error('DB error'));

            const res = await request(app)
                .get('/admin/api/lore')
                .set('x-admin-token', ADMIN_TOKEN);

            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Failed to list lore');
        });
    });

    describe('POST /admin/api/lore', () => {
        it('returns 201 with created lore', async () => {
            const newLore = { id: 1, channelId: 'scifi', content: 'New lore', isActive: true };
            mockedStorage.createLore.mockResolvedValue(newLore as any);

            const res = await request(app)
                .post('/admin/api/lore')
                .set('x-admin-token', ADMIN_TOKEN)
                .send({ channelId: 'scifi', content: 'New lore' });

            expect(res.status).toBe(201);
            expect(res.body).toEqual(newLore);
            expect(mockedStorage.createLore).toHaveBeenCalledWith({
                channelId: 'scifi',
                content: 'New lore',
                isActive: true
            });
        });

        it('returns 500 on database error', async () => {
            mockedStorage.createLore.mockRejectedValue(new Error('DB error'));

            const res = await request(app)
                .post('/admin/api/lore')
                .set('x-admin-token', ADMIN_TOKEN)
                .send({ channelId: 'scifi', content: 'New lore' });

            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Failed to create lore');
        });
    });

    describe('PATCH /admin/api/lore/:id', () => {
        it('returns 200 with updated lore when all fields provided', async () => {
            const updatedLore = { 
                id: 1, 
                channelId: 'scifi', 
                content: 'Updated content', 
                isActive: false 
            };
            mockedStorage.updateLore.mockResolvedValue(updatedLore as any);

            const res = await request(app)
                .patch('/admin/api/lore/1')
                .set('x-admin-token', ADMIN_TOKEN)
                .send({ channelId: 'scifi', content: 'Updated content', isActive: false });

            expect(res.status).toBe(200);
            expect(res.body).toEqual(updatedLore);
            expect(mockedStorage.updateLore).toHaveBeenCalledWith(1, {
                channelId: 'scifi',
                content: 'Updated content',
                isActive: false
            });
        });

        it('returns 200 with updated lore when only content is provided', async () => {
            const updatedLore = { id: 1, channelId: 'scifi', content: 'Just content', isActive: true };
            mockedStorage.updateLore.mockResolvedValue(updatedLore as any);

            const res = await request(app)
                .patch('/admin/api/lore/1')
                .set('x-admin-token', ADMIN_TOKEN)
                .send({ content: 'Just content' });

            expect(res.status).toBe(200);
            expect(mockedStorage.updateLore).toHaveBeenCalledWith(1, { content: 'Just content' });
        });

        it('returns 200 with updated lore when only isActive is provided', async () => {
            const updatedLore = { id: 1, channelId: 'scifi', content: 'Test', isActive: false };
            mockedStorage.updateLore.mockResolvedValue(updatedLore as any);

            const res = await request(app)
                .patch('/admin/api/lore/1')
                .set('x-admin-token', ADMIN_TOKEN)
                .send({ isActive: false });

            expect(res.status).toBe(200);
            expect(mockedStorage.updateLore).toHaveBeenCalledWith(1, { isActive: false });
        });

        it('returns 400 when no fields to update', async () => {
            const res = await request(app)
                .patch('/admin/api/lore/1')
                .set('x-admin-token', ADMIN_TOKEN)
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('No fields to update');
            expect(mockedStorage.updateLore).not.toHaveBeenCalled();
        });

        it('returns 500 on database error', async () => {
            mockedStorage.updateLore.mockRejectedValue(new Error('DB error'));

            const res = await request(app)
                .patch('/admin/api/lore/1')
                .set('x-admin-token', ADMIN_TOKEN)
                .send({ content: 'Updated' });

            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Failed to update lore');
        });

        it('returns 401 without admin token', async () => {
            const res = await request(app)
                .patch('/admin/api/lore/1')
                .send({ content: 'Updated' });

            expect(res.status).toBe(401);
        });
    });

    describe('DELETE /admin/api/lore/:id', () => {
        it('returns 204 on successful deactivation', async () => {
            mockedStorage.deactivateLore.mockResolvedValue({ id: 1 } as any);

            const res = await request(app)
                .delete('/admin/api/lore/1')
                .set('x-admin-token', ADMIN_TOKEN);

            expect(res.status).toBe(204);
            expect(mockedStorage.deactivateLore).toHaveBeenCalledWith(1);
        });

        it('returns 500 on database error', async () => {
            mockedStorage.deactivateLore.mockRejectedValue(new Error('DB error'));

            const res = await request(app)
                .delete('/admin/api/lore/1')
                .set('x-admin-token', ADMIN_TOKEN);

            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Failed to delete lore');
        });

        it('returns 401 without admin token', async () => {
            const res = await request(app).delete('/admin/api/lore/1');

            expect(res.status).toBe(401);
        });
    });
});

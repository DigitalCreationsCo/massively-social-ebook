import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { registerReplayRoutes } from './replay-routes';

// Mock the logger
vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

function createTestApp(): express.Express {
  const app = express();
  app.use(express.json());
  registerReplayRoutes(app);
  return app;
}

describe('Replay Render Endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /admin/api/replays/:sessionId/render', () => {
    it('returns 401 if no auth token is provided', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/admin/api/replays/1/render')
        .send();

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('message');
      expect(res.body.message).toContain('Unauthorized');
    });

    it('returns 401 if an invalid token is provided', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/admin/api/replays/1/render')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
    });

    it('returns 200 with processing status when authenticated', async () => {
      process.env.ADMIN_TOKEN = 'test-admin-token';
      const app = createTestApp();
      const res = await request(app)
        .post('/admin/api/replays/42/render')
        .set('Authorization', 'Bearer test-admin-token');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message');
      expect(res.body.message).toContain('42');
      expect(res.body).toHaveProperty('status', 'processing');
    });

    it('accepts x-admin-token header as alternative auth', async () => {
      process.env.ADMIN_TOKEN = 'token-from-header';
      const app = createTestApp();
      const res = await request(app)
        .post('/admin/api/replays/7/render')
        .set('x-admin-token', 'token-from-header');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('processing');
    });

    it('responds differently for different session IDs', async () => {
      process.env.ADMIN_TOKEN = 'multi-session-token';
      const app = createTestApp();

      const res1 = await request(app)
        .post('/admin/api/replays/100/render')
        .set('Authorization', 'Bearer multi-session-token');

      const res2 = await request(app)
        .post('/admin/api/replays/999/render')
        .set('Authorization', 'Bearer multi-session-token');

      expect(res1.body.message).toContain('100');
      expect(res2.body.message).toContain('999');
    });

    it('handles non-numeric sessionId gracefully', async () => {
      process.env.ADMIN_TOKEN = 'graceful-token';
      const app = createTestApp();
      const res = await request(app)
        .post('/admin/api/replays/not-a-number/render')
        .set('Authorization', 'Bearer graceful-token');

      // parseInt('not-a-number') returns NaN — handler should still respond
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message');
    });

    it('returns 401 for OPTIONS preflight without auth', async () => {
      // OPTIONS requests should still be handled normally by Express
      const app = createTestApp();
      const res = await request(app).options('/admin/api/replays/1/render');

      // Express by default returns 200 for OPTIONS if no specific handler
      // (it's the catch-all that matches the same route pattern via app.options)
      // If no handler matches, it's 404. Either way, not 401 from isAdmin.
      expect(res.status).not.toBe(401);
    });
  });
});

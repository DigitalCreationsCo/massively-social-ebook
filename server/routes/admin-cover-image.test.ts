import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { registerAdminRoutes } from './admin-routes';

// ── Mocks ────────────────────────────────────────────────────────────────────
// vi.mock() calls are hoisted above all other code by Vitest's transform.
// vi.hoisted() creates variables at the same hoisted scope so they're
// available when the mock factories execute.

const { mockStorage, mockGenerateAndUploadImage } = vi.hoisted(() => ({
  mockStorage: {
    getChannels: vi.fn(),
    createChannel: vi.fn(),
    updateChannel: vi.fn(),
    deleteChannel: vi.fn(),
  },
  mockGenerateAndUploadImage: vi.fn(),
}));

vi.mock('../storage', () => ({
  storage: mockStorage,
}));

vi.mock('../image-uploader', () => ({
  generateAndUploadStoryImage: (...args: unknown[]) =>
    mockGenerateAndUploadImage(...args),
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());

  // Bypass auth middleware for tests
  process.env.ADMIN_TOKEN = 'test-token';
  registerAdminRoutes(app);
  return app;
}

const AUTH_HEADER = { 'x-admin-token': 'test-token' };

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Admin Channels Cover Image Routes', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  // ── POST /admin/api/channels ─────────────────────────────────────────────

  describe('POST /admin/api/channels', () => {
    const baseBody = { channelId: 'horror', name: 'Horror Stories' };

    it('auto-generates and uploads cover image from description when none provided', async () => {
      const fakeGcsUrl = 'https://storage.googleapis.com/bucket/channels/horror/images/cover/uuid.jpg';
      mockGenerateAndUploadImage.mockResolvedValue(fakeGcsUrl);
      mockStorage.createChannel.mockResolvedValue({
        id: 1,
        ...baseBody,
        description: 'A dark and scary world',
        coverImage: fakeGcsUrl,
        createdAt: new Date(),
      });

      const res = await request(app)
        .post('/admin/api/channels')
        .set(AUTH_HEADER)
        .send({ ...baseBody, description: 'A dark and scary world' });

      expect(res.status).toBe(201);
      expect(mockGenerateAndUploadImage).toHaveBeenCalledWith(
        'A dark and scary world',
        'horror',
        'cover',
      );
      expect(mockStorage.createChannel).toHaveBeenCalledWith(
        expect.objectContaining({ coverImage: fakeGcsUrl }),
      );
    });

    it('skips image generation when coverImage is already provided', async () => {
      const providedUrl = 'https://cdn.example.com/my-cover.jpg';
      mockStorage.createChannel.mockResolvedValue({
        id: 2,
        ...baseBody,
        coverImage: providedUrl,
        createdAt: new Date(),
      });

      const res = await request(app)
        .post('/admin/api/channels')
        .set(AUTH_HEADER)
        .send({ ...baseBody, coverImage: providedUrl });

      expect(res.status).toBe(201);
      expect(mockGenerateAndUploadImage).not.toHaveBeenCalled();
      expect(mockStorage.createChannel).toHaveBeenCalledWith(
        expect.objectContaining({ coverImage: providedUrl }),
      );
    });

    it('skips image generation when no description is provided', async () => {
      mockStorage.createChannel.mockResolvedValue({
        id: 3,
        ...baseBody,
        createdAt: new Date(),
      });

      const res = await request(app)
        .post('/admin/api/channels')
        .set(AUTH_HEADER)
        .send(baseBody);

      expect(res.status).toBe(201);
      expect(mockGenerateAndUploadImage).not.toHaveBeenCalled();
    });

    it('creates channel even if image generation fails (graceful degradation)', async () => {
      mockGenerateAndUploadImage.mockRejectedValue(new Error('AI service unavailable'));
      mockStorage.createChannel.mockResolvedValue({
        id: 4,
        ...baseBody,
        description: 'A spooky forest',
        coverImage: undefined,
        createdAt: new Date(),
      });

      const res = await request(app)
        .post('/admin/api/channels')
        .set(AUTH_HEADER)
        .send({ ...baseBody, description: 'A spooky forest' });

      expect(res.status).toBe(201);
      expect(mockGenerateAndUploadImage).toHaveBeenCalled();
      // coverImage should be undefined because generation failed
      expect(mockStorage.createChannel).toHaveBeenCalledWith(
        expect.objectContaining({ coverImage: undefined }),
      );
    });
  });

  // ── PATCH /admin/api/channels/:id ────────────────────────────────────────

  describe('PATCH /admin/api/channels/:id', () => {
    it('updates channel with a new coverImage URL', async () => {
      const newCover = 'https://cdn.example.com/new-cover.jpg';
      mockStorage.updateChannel.mockResolvedValue({
        id: 1,
        channelId: 'horror',
        name: 'Horror Stories',
        coverImage: newCover,
        createdAt: new Date(),
      });

      const res = await request(app)
        .patch('/admin/api/channels/1')
        .set(AUTH_HEADER)
        .send({ coverImage: newCover });

      expect(res.status).toBe(200);
      expect(mockStorage.updateChannel).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ coverImage: newCover }),
      );
    });

    it('clears coverImage when explicitly set to empty string', async () => {
      mockStorage.updateChannel.mockResolvedValue({
        id: 1,
        channelId: 'horror',
        name: 'Horror Stories',
        coverImage: '',
        createdAt: new Date(),
      });

      const res = await request(app)
        .patch('/admin/api/channels/1')
        .set(AUTH_HEADER)
        .send({ coverImage: '' });

      expect(res.status).toBe(200);
      expect(mockStorage.updateChannel).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ coverImage: '' }),
      );
    });
  });

  // ── POST /admin/api/channels/:id/generate-cover ─────────────────────────

  describe('POST /admin/api/channels/:id/generate-cover', () => {
    it('generates, uploads to GCS, and saves a new cover image from description', async () => {
      const fakeGcsUrl = 'https://storage.googleapis.com/bucket/channels/horror/images/cover/uuid.jpg';
      mockGenerateAndUploadImage.mockResolvedValue(fakeGcsUrl);
      // The endpoint looks up the channel to get its channelId for GCS path
      mockStorage.getChannels.mockResolvedValue([
        { id: 1, channelId: 'horror', name: 'Horror Stories', description: '', coverImage: null, createdAt: new Date() },
      ]);
      mockStorage.updateChannel.mockResolvedValue({
        id: 1,
        channelId: 'horror',
        name: 'Horror Stories',
        coverImage: fakeGcsUrl,
        createdAt: new Date(),
      });

      const res = await request(app)
        .post('/admin/api/channels/1/generate-cover')
        .set(AUTH_HEADER)
        .send({ description: 'A grim haunted house' });

      expect(res.status).toBe(200);
      expect(mockGenerateAndUploadImage).toHaveBeenCalledWith(
        'A grim haunted house',
        'horror',
        'cover',
      );
      expect(mockStorage.updateChannel).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ coverImage: fakeGcsUrl }),
      );
      expect(res.body.coverImage).toBe(fakeGcsUrl);
    });

    it('returns 400 when description is missing', async () => {
      const res = await request(app)
        .post('/admin/api/channels/1/generate-cover')
        .set(AUTH_HEADER)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Description is required');
      expect(mockGenerateAndUploadImage).not.toHaveBeenCalled();
    });

    it('returns 500 when image generation fails', async () => {
      mockGenerateAndUploadImage.mockRejectedValue(new Error('Model overloaded'));
      mockStorage.getChannels.mockResolvedValue([
        { id: 1, channelId: 'horror', name: 'Horror Stories', description: '', coverImage: null, createdAt: new Date() },
      ]);

      const res = await request(app)
        .post('/admin/api/channels/1/generate-cover')
        .set(AUTH_HEADER)
        .send({ description: 'Some description' });

      expect(res.status).toBe(500);
      expect(res.body.message).toContain('Failed to generate cover image');
    });
  });

      const res = await request(app)
        .post('/admin/api/channels/1/generate-cover')
        .set(AUTH_HEADER)
        .send({ description: 'A grim haunted house' });

      expect(res.status).toBe(200);
      expect(mockGenerateAndUploadImage).toHaveBeenCalledWith('A grim haunted house');
      expect(mockStorage.updateChannel).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ coverImage: generatedImage }),
      );
      expect(res.body.coverImage).toBe(generatedImage);
    });

    it('returns 400 when description is missing', async () => {
      const res = await request(app)
        .post('/admin/api/channels/1/generate-cover')
        .set(AUTH_HEADER)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Description is required');
      expect(mockGenerateAndUploadImage).not.toHaveBeenCalled();
    });

    it('returns 500 when image generation fails', async () => {
      mockGenerateAndUploadImage.mockRejectedValue(new Error('Model overloaded'));

      const res = await request(app)
        .post('/admin/api/channels/1/generate-cover')
        .set(AUTH_HEADER)
        .send({ description: 'Some description' });

      expect(res.status).toBe(500);
      expect(res.body.message).toContain('Failed to generate cover image');
    });
  });

  // ── Auth guard ──────────────────────────────────────────────────────────

  describe('Auth enforcement', () => {
    it('rejects unauthenticated requests to generate-cover', async () => {
      const res = await request(app)
        .post('/admin/api/channels/1/generate-cover')
        .send({ description: 'test' });

      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated requests to create channel', async () => {
      const res = await request(app)
        .post('/admin/api/channels')
        .send({ channelId: 'x', name: 'x' });

      expect(res.status).toBe(401);
    });
  });
});

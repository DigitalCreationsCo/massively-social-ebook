import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseStorage } from './storage';
import { db } from './db';

// Mock the db
vi.mock('./db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  }
}));

describe('Server Storage & Fallback', () => {
  const storage = new DatabaseStorage();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getRandomImage', () => {
    it('returns a random image URL from existing blocks', async () => {
      const mockBlocks = [
        { imageUrl: 'url1.jpg' },
        { imageUrl: 'url2.jpg' },
        { imageUrl: null },
      ];

      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockBlocks),
      });

      const result = await storage.getRandomImage('scifi');
      expect(['url1.jpg', 'url2.jpg']).toContain(result);
    });

    it('returns null if no images are found', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      });

      const result = await storage.getRandomImage('scifi');
      expect(result).toBeNull();
    });
  });
});

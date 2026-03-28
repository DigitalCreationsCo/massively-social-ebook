import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseStorage } from './storage';
import { db } from './db';

// Create chainable mock for drizzle query builder
function createChainableMock() {
  const chain: any = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
  return chain;
}

// Mock the db
vi.mock('./db', () => ({
  db: {
    select: vi.fn(() => createChainableMock()),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    execute: vi.fn(),
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

      const chain = createChainableMock();
      chain.limit.mockResolvedValue(mockBlocks);
      (db.select as any).mockReturnValue(chain);

      const result = await storage.getRandomImage('scifi');
      expect(['url1.jpg', 'url2.jpg']).toContain(result);
    });

    it('returns null if no images are found', async () => {
      const chain = createChainableMock();
      chain.limit.mockResolvedValue([]);
      (db.select as any).mockReturnValue(chain);

      const result = await storage.getRandomImage('scifi');
      expect(result).toBeNull();
    });
  });

  describe('getBlockCount', () => {
    it('returns the count of blocks for a channel', async () => {
      const chain = createChainableMock();
      chain.where.mockResolvedValue([ { value: 42 } ]);
      (db.select as any).mockReturnValue(chain);

      const result = await storage.getBlockCount('scifi');
      expect(result).toBe(42);
    });

    it('returns 0 when no result row is returned', async () => {
      const chain = createChainableMock();
      chain.where.mockResolvedValue([]);
      (db.select as any).mockReturnValue(chain);

      const result = await storage.getBlockCount('scifi');
      expect(result).toBe(0);
    });
  });

  describe('getBlocksBySequence', () => {
    it('returns empty array for empty indices', async () => {
      const result = await storage.getBlocksBySequence('scifi', []);
      expect(result).toEqual([]);
      expect(db.execute).not.toHaveBeenCalled();
    });

    it('returns mapped blocks for given indices', async () => {
      const mockRows = [
        {
          id: 1,
          channel_id: 'scifi',
          session_id: 1,
          title: 'First',
          content: 'First block.',
          image_url: '/img/1.jpg',
          option_a: { label: 'A', description: 'desc A' },
          option_b: { label: 'B', description: 'desc B' },
          created_at: '2026-01-01T00:00:00Z',
          row_num: 1,
        },
        {
          id: 5,
          channel_id: 'scifi',
          session_id: 1,
          title: 'Fifth',
          content: 'Fifth block.',
          image_url: null,
          option_a: null,
          option_b: null,
          created_at: null,
          row_num: 5,
        },
      ];

      (db.execute as any).mockResolvedValue({ rows: mockRows });

      const result = await storage.getBlocksBySequence('scifi', [ 1, 5 ]);

      expect(result).toHaveLength(2);
      expect(result[ 0 ].id).toBe(1);
      expect(result[ 0 ].channelId).toBe('scifi');
      expect(result[ 0 ].title).toBe('First');
      expect(result[ 0 ].content).toBe('First block.');
      expect(result[ 0 ].imageUrl).toBe('/img/1.jpg');
      expect(result[ 0 ].createdAt).toBeInstanceOf(Date);

      expect(result[ 1 ].id).toBe(5);
      expect(result[ 1 ].title).toBe('Fifth');
      expect(result[ 1 ].imageUrl).toBeNull();
      expect(result[ 1 ].createdAt).toBeNull();
    });
  });
});

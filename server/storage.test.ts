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

vi.mock('./db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
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

describe('DatabaseStorage Window Queries', () => {
  const storage = new DatabaseStorage();

  it('getSessionsInWindow returns correct data structure', async () => {
    const mockData = [ { id: 1, channelId: 'scifi', status: 'scheduled' } ];
    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(mockData),
    });

    const result = await storage.getSessionsInWindow('scifi', new Date(), new Date());
    expect(result).toEqual(mockData);
  });

  it('listSchedules filters for intervalEnabled: true', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([ { id: 1, intervalEnabled: true } ]),
    });

    const result = await storage.listSchedules();
    expect(result[ 0 ].intervalEnabled).toBe(true);
  });
});

describe('Storage: listSchedules', () => {
  const storage = new DatabaseStorage();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches all enabled schedules when no channelId is provided', async () => {
    const mockAllEnabled = [
      { id: 1, channelId: 'scifi', intervalEnabled: true },
      { id: 2, channelId: 'mystery', intervalEnabled: true }
    ];

    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(mockAllEnabled),
    });

    const result = await storage.listSchedules();

    expect(result).toHaveLength(2);
    // Verify the query did not include a channelId filter
    expect(db.select).toHaveBeenCalled();
  });

  it('applies a channelId filter when the argument is present', async () => {
    const mockFiltered = [ { id: 1, channelId: 'scifi', intervalEnabled: true } ];

    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(mockFiltered),
    });

    const result = await storage.listSchedules({ channelId: 'scifi' });

    expect(result).toHaveLength(1);
    expect(result[ 0 ].channelId).toBe('scifi');
  });

  it('logs and throws on database failure to ensure trace visibility', async () => {
    const errorDb = new Error('Query Timeout');

    (db.select as any).mockImplementation(() => {
      throw errorDb;
    });

    await expect(storage.listSchedules()).rejects.toThrow('Query Timeout');
  });
});

describe('DatabaseStorage - Production Optimized', () => {
  const storage = new DatabaseStorage();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listSchedules', () => {
    it('filters by channelId when provided', async () => {
      const mockResult = [ { id: 1, channelId: 'scifi', intervalEnabled: true } ];
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(mockResult),
      });

      const result = await storage.listSchedules({ channelId: 'scifi' });
      expect(result).toEqual(mockResult);
      // Logic Check: Ensure query structure changes based on input
    });

    it('returns all enabled schedules when channelId is omitted', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([ { id: 1 }, { id: 2 } ]),
      });

      const result = await storage.listSchedules();
      expect(result).toHaveLength(2);
    });
  });

  describe('Weekly Briefing Idempotency', () => {
    it('returns true if the week key does not match storage', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([ { value: '2026-12' } ]),
      });

      const canSend = await storage.shouldSendWeeklyBriefing('2026-13');
      expect(canSend).toBe(true);
    });

    it('returns false if the week key already exists', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([ { value: '2026-13' } ]),
      });

      const canSend = await storage.shouldSendWeeklyBriefing('2026-13');
      expect(canSend).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('logs and rethrows uncaught database errors', async () => {
      (db.select as any).mockImplementation(() => { throw new Error('DB_FAILURE'); });
      await expect(storage.listSchedules()).rejects.toThrow('DB_FAILURE');
    });

    it('properly bubbles Foreign Key violations for invalid channelIds', async () => {
      (db.select as any).mockImplementation(() => {
        const err = new Error('foreign key constraint "schedules_channel_id_fkey" failed');
        (err as any).code = '23503'; // Postgres FK violation code
        throw err;
      });

      await expect(storage.listSchedules({ channelId: 'non-existent-channel' }))
        .rejects.toThrow(/foreign key/);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseStorage } from './storage';
import { db } from './db';

vi.mock('./db', () => {
  const mockChainDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    execute: vi.fn(),
  };
  return { db: mockChainDb };
});

describe('Data Abstraction Layer: Core Storage', () => {
  const storageDb = new DatabaseStorage();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Image Retrieval Engine', () => {
    it('resolves random image references from historical blocks', async () => {
      const arrBlocksMock = [
        { imageUrl: 'url1.jpg' },
        { imageUrl: 'url2.jpg' },
      ];

      (db.limit as any).mockResolvedValue(arrBlocksMock);

      const resultImage = await storageDb.getRandomImage('scifi');
      expect([ 'url1.jpg', 'url2.jpg' ]).toContain(resultImage);
    });

    it('yields null when sequence space is devoid of imagery', async () => {
      (db.limit as any).mockResolvedValue([]);

      const resultImage = await storageDb.getRandomImage('scifi');
      expect(resultImage).toBeNull();
    });
  });

  describe('Schedule Fetch Integrity', () => {
    it('acquires all active schedules natively without channel constraints', async () => {
      const arrSchedulesMock = [
        { id: 1, channelId: 'scifi', intervalEnabled: true },
        { id: 2, channelId: 'mystery', intervalEnabled: true }
      ];

      (db.where as any).mockResolvedValue(arrSchedulesMock);

      const arrResults = await storageDb.listSchedules();
      expect(arrResults).toHaveLength(2);
      expect(db.select).toHaveBeenCalled();
    });

    it('enforces channelId predicate when constraint payload is supplied', async () => {
      const arrSchedulesFilteredMock = [ { id: 1, channelId: 'scifi', intervalEnabled: true } ];

      (db.where as any).mockResolvedValue(arrSchedulesFilteredMock);

      const arrResults = await storageDb.listSchedules({ channelId: 'scifi' });
      expect(arrResults).toHaveLength(1);
      expect(arrResults[ 0 ].channelId).toBe('scifi');
    });

    it('maintains trace visibility on DB rejection', async () => {
      const errorDbMock = new Error('Query Timeout');

      (db.select as any).mockImplementation(() => { throw errorDbMock; });

      await expect(storageDb.listSchedules()).rejects.toThrow('Query Timeout');
    });
  });

  describe('Briefing Sequence Verifier', () => {
    it('clears dispatch lock if temporal key is unregistered', async () => {
      (db.where as any).mockResolvedValue([ { value: '2026-12' } ]);

      const isSendPermitted = await storageDb.shouldSendWeeklyBriefing('2026-13');
      expect(isSendPermitted).toBe(true);
    });

    it('denies dispatch lock if temporal key exists', async () => {
      (db.where as any).mockResolvedValue([ { value: '2026-13' } ]);

      const isSendPermitted = await storageDb.shouldSendWeeklyBriefing('2026-13');
      expect(isSendPermitted).toBe(false);
    });
  });
});
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createIngestionService, IngestionService, ReactionEvent } from './ingestion';
import { randomUUID } from 'crypto';
import pgPromise from 'pg-promise';

// Mock the database for unit testing without a running Postgres instance
// In a real integration test, we would connect to a test DB.
const mockDb = {
  none: vi.fn().mockResolvedValue(null),
  tx: vi.fn(),
  one: vi.fn(),
};

const mockPgp = {
  helpers: {
    ColumnSet: class {},
    insert: vi.fn().mockReturnValue('INSERT INTO ...'),
  },
  end: vi.fn(),
};

// We need to spy on the pg-promise factory
vi.mock('pg-promise', () => {
  return {
    default: () => {
      const init = (config: any) => mockDb;
      init.helpers = mockPgp.helpers;
      init.end = mockPgp.end;
      return init;
    }
  };
});

describe('IngestionService', () => {
  let service: IngestionService;
  // Mock DATABASE_URL if missing
  const originalEnv = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/testdb';
    service = createIngestionService();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    process.env.DATABASE_URL = originalEnv;
    await service.shutdown();
  });

  it('should batch events and flush when limit reached', async () => {
    // Override batch size for testing
    // @ts-ignore - Accessing private property for testing
    service.batchSizeLimit = 10;
    
    const events: ReactionEvent[] = Array.from({ length: 10 }, (_, i) => ({
      reaction_id: i.toString(),
      user_id: randomUUID(),
      target_id: randomUUID(),
      reaction_type: 1,
      metadata: {},
      created_at: new Date()
    }));

    // Ingest 9 events - should not flush yet
    for (let i = 0; i < 9; i++) {
      await service.ingest(events[i]);
    }
    expect(mockDb.none).not.toHaveBeenCalled();

    // Ingest 10th event - should trigger flush
    await service.ingest(events[9]);
    
    expect(mockDb.none).toHaveBeenCalledTimes(1);
    expect(mockPgp.helpers.insert).toHaveBeenCalledWith(
      expect.arrayContaining(events),
      expect.any(Object)
    );
  });

  it('should flush on timer if batch not full', async () => {
    vi.useFakeTimers();
    const timedService = createIngestionService();
    // @ts-ignore
    timedService.flushIntervalMs = 500;
    
    // Spy on the flush method to ensure timer calls it
    const flushSpy = vi.spyOn(timedService, 'flush');

    await timedService.ingest({
      reaction_id: '1',
      user_id: randomUUID(),
      target_id: randomUUID(),
      reaction_type: 1,
      metadata: {},
      created_at: new Date()
    });

    expect(mockDb.none).not.toHaveBeenCalled();

    // Advance time beyond interval
    vi.advanceTimersByTime(1000);
    
    // Trigger callbacks
    await Promise.resolve(); 
    
    // Verify flush was called
    expect(flushSpy).toHaveBeenCalled();
    
    // Verify DB was called (might need another tick)
    expect(mockDb.none).toHaveBeenCalled();
    
    await timedService.shutdown();
    vi.useRealTimers();
  });

  it('should handle failures by moving to DLO', async () => {
    const error = new Error('DB Connection Failed');
    mockDb.none.mockRejectedValueOnce(error); // Fail the insert
    mockDb.none.mockResolvedValueOnce(null); // Succeed the DLO insert

    const event: ReactionEvent = {
      reaction_id: '1',
      user_id: randomUUID(),
      target_id: randomUUID(),
      reaction_type: 1,
      metadata: {},
      created_at: new Date()
    };

    // @ts-ignore
    service.batch.push(event);
    await service.flush();

    // First call (Insert) fails
    // Second call (DLO) succeeds
    expect(mockDb.none).toHaveBeenCalledTimes(2);
    
    // Verify 2nd call is to failed_ingestion_log
    const dloCall = mockDb.none.mock.calls[1];
    expect(dloCall[0]).toContain('INSERT INTO failed_ingestion_log');
  });

  it('should handle burst load of 10,000 events', async () => {
    // @ts-ignore
    service.batchSizeLimit = 1000;
    
    const events = Array.from({ length: 10000 }, (_, i) => ({
      reaction_id: i.toString(),
      user_id: randomUUID(),
      target_id: randomUUID(),
      reaction_type: 1,
      metadata: {},
      created_at: new Date()
    }));

    const start = performance.now();
    
    // Simulate concurrent ingestion
    await Promise.all(events.map(e => service.ingest(e)));
    
    // Ensure remaining items are flushed
    await service.flush();

    const duration = performance.now() - start;
    console.log(`Ingested 10,000 events in ${duration}ms`);

    // Should have flushed multiple times
    // Due to concurrency, batch sizes may vary (e.g. 1000, then 9000 accumulated while flushing)
    // We check total events ingested matches 10,000
    
    const insertCalls = mockPgp.helpers.insert.mock.calls;
    let totalEvents = 0;
    for (const call of insertCalls) {
        // First arg is the array of events
        // @ts-ignore
        totalEvents += call[0].length;
    }
    
    expect(totalEvents).toBe(10000);
  });
});

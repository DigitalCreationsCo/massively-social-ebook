import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleGameLoopTick,
  READING_SEGMENT_MS,
  START_BEFORE_MS,
  LOBBY_DELAY_MS,
  clearChannelCache,
} from './routes/index';
import { storage } from './storage';
import * as batchGenerate from './blocks/batch-generate';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('./storage', () => ({
  storage: {
    getActiveChannels: vi.fn(),
    getChannelState: vi.fn(),
    getNextSession: vi.fn(),
    getSessionById: vi.fn(),
    tryAcquireGameLock: vi.fn(),
    releaseGameLock: vi.fn(),
    upsertChannelState: vi.fn(),
    updateSessionStatus: vi.fn(),
    getBlocksBySessionOrdered: vi.fn(),
  },
}));

vi.mock('./blocks/batch-generate', () => ({
  batchGenerateBlocks: vi.fn().mockResolvedValue({ blocksGenerated: 5, blocksFailed: 0, errors: [] }),
  getPreviousSessionContext: vi.fn().mockResolvedValue({ title: 'Previous', content: '...' }),
}));

vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockedStorage = vi.mocked(storage);
const mockedBatchGenerate = vi.mocked(batchGenerate);

// ── Helpers ─────────────────────────────────────────────────────────────────────

function mockChannel(channelId = 'scifi') {
  return { id: 1, channelId, name: 'Sci-Fi', description: '', coverImage: null, createdAt: new Date() };
}

function mockSession(overrides: Partial<any> = {}) {
  const now = Date.now();
  return {
    id: 1,
    channelId: 'scifi',
    title: 'Episode 1',
    description: 'The mystery begins.',
    scheduledStart: new Date(now - 10_000),
    scheduledEnd: new Date(now + 24 * 60 * 60 * 1000), // 24h discussion window
    timezone: 'UTC',
    status: 'scheduled',
    notifyCount: 0,
    sessionNumber: 1,
    seasonNumber: 1,
    episodeNumber: 1,
    subtitle: null,
    scheduleId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function mockChannelState(overrides: Partial<any> = {}) {
  const now = Date.now();
  return {
    channelId: 'scifi',
    currentPhase: 'reading',
    phaseEndsAt: new Date(now + READING_SEGMENT_MS),
    decisionEndsAt: new Date(now + READING_SEGMENT_MS),
    initialTimeToDecision: 0,
    turnsToNextChoice: 0,
    currentBlockId: 1,
    activeSessionId: 1,
    processingLockedUntil: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockBlock(overrides: Partial<any> = {}) {
  return {
    id: 1,
    channelId: 'scifi',
    sessionId: 1,
    title: 'The Beginning',
    content: 'Story text...',
    dialogue: null,
    imageUrl: '/images/test.jpg',
    optionA: { label: 'Go Left', description: 'Venture left' },
    optionB: { label: 'Go Right', description: 'Go right' },
    ttsEnabled: true,
    audioUrl: null,
    isNotable: false,
    embedding: null,
    searchVector: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe('handleGameLoopTick', () => {
  const mockBroadcast = vi.fn();
  const BASE_NOW = 1_000_000_000_000;

  beforeEach(() => {
    vi.clearAllMocks();
    clearChannelCache();
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(BASE_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Session Lifecycle ────────────────────────────────────────────────────────

  it('starts a scheduled session when the start threshold is reached', async () => {
    const session = mockSession({
      scheduledStart: new Date(BASE_NOW - 60_000), // Started 1 min ago
      scheduledEnd: new Date(BASE_NOW + 86_400_000),
      status: 'scheduled',
    });

    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(null); // No channel state yet
    mockedStorage.getNextSession.mockResolvedValue(session);
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.getBlocksBySessionOrdered.mockResolvedValue([mockBlock()]); // Pre-generated
    mockedStorage.upsertChannelState.mockResolvedValue(undefined as any);
    mockedStorage.updateSessionStatus.mockResolvedValue(undefined as any);

    await handleGameLoopTick(BASE_NOW, mockBroadcast);

    // Should have activated the session
    expect(mockedStorage.updateSessionStatus).toHaveBeenCalledWith(session.id, 'active');
    expect(mockedStorage.upsertChannelState).toHaveBeenCalledWith(
      'scifi',
      expect.objectContaining({
        currentPhase: 'reading',
        activeSessionId: session.id,
      }),
    );
    // Should have released the lock
    expect(mockedStorage.releaseGameLock).toHaveBeenCalledWith('scifi');

    // Should broadcast session status
    expect(mockBroadcast).toHaveBeenCalledWith('scifi', {
      type: 'SESSION_STATUS',
      payload: { status: 'active', session },
    });
  });

  it('calls batchGenerateBlocks when no pre-generated blocks exist', async () => {
    const session = mockSession({
      scheduledStart: new Date(BASE_NOW - 60_000),
      status: 'scheduled',
    });

    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(null);
    mockedStorage.getNextSession.mockResolvedValue(session);
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    // No blocks pre-generated
    mockedStorage.getBlocksBySessionOrdered
      .mockResolvedValueOnce([])  // First call: empty
      .mockResolvedValueOnce([mockBlock()]); // Second call: now available
    mockedStorage.upsertChannelState.mockResolvedValue(undefined as any);
    mockedStorage.updateSessionStatus.mockResolvedValue(undefined as any);

    await handleGameLoopTick(BASE_NOW, mockBroadcast);

    // Should have triggered batch generation
    expect(mockedBatchGenerate.batchGenerateBlocks).toHaveBeenCalledWith(
      'scifi',
      session.id,
      expect.any(Object),
    );
  });

  it('does NOT start a session before the start threshold', async () => {
    const session = mockSession({
      scheduledStart: new Date(BASE_NOW + 10 * 60 * 1000), // 10 min from now
      status: 'scheduled',
    });

    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(null);
    mockedStorage.getNextSession.mockResolvedValue(session);

    await handleGameLoopTick(BASE_NOW, mockBroadcast);

    // Should not have started anything
    expect(mockedStorage.updateSessionStatus).not.toHaveBeenCalled();
    expect(mockedStorage.upsertChannelState).not.toHaveBeenCalled();
  });

  it('returns { continue: false } when no active session and no next session', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(null);
    mockedStorage.getNextSession.mockResolvedValue(null);

    const result = await handleGameLoopTick(BASE_NOW, mockBroadcast);
    expect(result).toEqual({ continue: false });
  });

  // ── Active Session Behaviors ────────────────────────────────────────────────

  it('returns { continue: true } for an active session within its window', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ phaseEndsAt: new Date(BASE_NOW + 10_000) })
    );
    mockedStorage.getSessionById.mockResolvedValue(
      mockSession({ scheduledEnd: new Date(BASE_NOW + 86_400_000) })
    );

    const result = await handleGameLoopTick(BASE_NOW, mockBroadcast);
    expect(result).toEqual({ continue: true });
  });

  it('sends heartbeat SYNC_STATE for an active session', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    // Populate cache with channel state
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ phaseEndsAt: new Date(BASE_NOW + 10_000) })
    );
    mockedStorage.getSessionById.mockResolvedValue(
      mockSession({ scheduledEnd: new Date(BASE_NOW + 86_400_000) })
    );

    // First call populates cache
    await handleGameLoopTick(BASE_NOW, mockBroadcast);

    // Should broadcast SYNC_STATE with time remaining
    expect(mockBroadcast).toHaveBeenCalledWith('scifi', expect.objectContaining({
      type: 'SYNC_STATE',
      payload: expect.objectContaining({
        timeRemaining: expect.any(Number),
        phaseInitialMs: READING_SEGMENT_MS,
      }),
    }));
  });

  // ── Session Expiry (Discussion Window) ───────────────────────────────────────

  it('completes session when discussion window expires', async () => {
    const session = mockSession({
      scheduledEnd: new Date(BASE_NOW - 1_000), // Just expired
    });

    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ activeSessionId: session.id })
    );
    mockedStorage.getSessionById.mockResolvedValue(session);
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.updateSessionStatus.mockResolvedValue(undefined as any);
    mockedStorage.upsertChannelState.mockResolvedValue(undefined as any);

    const result = await handleGameLoopTick(BASE_NOW, mockBroadcast);

    // Should have marked session as completed
    expect(mockedStorage.updateSessionStatus).toHaveBeenCalledWith(session.id, 'completed');
    // Should have cleared channel state
    expect(mockedStorage.upsertChannelState).toHaveBeenCalledWith('scifi', {
      activeSessionId: null,
      currentBlockId: null,
      currentPhase: 'reading',
    });
    // Should broadcast completed status
    expect(mockBroadcast).toHaveBeenCalledWith('scifi', {
      type: 'SESSION_STATUS',
      payload: { status: 'completed', session },
    });
    // Should return continue: false
    expect(result).toEqual({ continue: false });
  });

  it('releases lock even after session expiry succeeds', async () => {
    const session = mockSession({
      scheduledEnd: new Date(BASE_NOW - 1_000),
    });

    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ activeSessionId: session.id })
    );
    mockedStorage.getSessionById.mockResolvedValue(session);
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.updateSessionStatus.mockResolvedValue(undefined as any);
    mockedStorage.upsertChannelState.mockResolvedValue(undefined as any);

    await handleGameLoopTick(BASE_NOW, mockBroadcast);

    // Lock should be released in the finally block
    expect(mockedStorage.releaseGameLock).toHaveBeenCalledWith('scifi');
  });

  // ── Edge Cases ──────────────────────────────────────────────────────────────

  it('clears stale activeSessionId when session is missing', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ activeSessionId: 999 }) // Non-existent session
    );
    mockedStorage.getSessionById.mockResolvedValue(null); // Not found

    await handleGameLoopTick(BASE_NOW, mockBroadcast);

    expect(mockedStorage.upsertChannelState).toHaveBeenCalledWith('scifi', {
      activeSessionId: null,
      currentBlockId: null,
    });
  });

  it('handles lock contention gracefully (does not duplicate session start)', async () => {
    const session = mockSession({
      scheduledStart: new Date(BASE_NOW - 60_000),
      status: 'scheduled',
    });

    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(null);
    mockedStorage.getNextSession.mockResolvedValue(session);
    mockedStorage.tryAcquireGameLock.mockResolvedValue(false); // Lock not acquired

    await handleGameLoopTick(BASE_NOW, mockBroadcast);

    // Should NOT have started anything
    expect(mockedStorage.updateSessionStatus).not.toHaveBeenCalled();
    expect(mockedStorage.upsertChannelState).not.toHaveBeenCalled();
  });

  it('handles errors gracefully without throwing', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockRejectedValue(new Error('DB connection error'));

    await expect(
      handleGameLoopTick(BASE_NOW, mockBroadcast)
    ).resolves.not.toThrow();
  });

  // ── Cache Behaviors ─────────────────────────────────────────────────────────

  it('uses cached channel state on subsequent ticks', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ phaseEndsAt: new Date(BASE_NOW + 10_000) })
    );
    mockedStorage.getSessionById.mockResolvedValue(
      mockSession({ scheduledEnd: new Date(BASE_NOW + 86_400_000) })
    );

    // First tick — cache miss, calls getChannelState
    await handleGameLoopTick(BASE_NOW + 1_000, mockBroadcast);
    expect(mockedStorage.getChannelState).toHaveBeenCalledTimes(1);

    mockedStorage.getChannelState.mockClear();

    // Second tick — cache hit
    await handleGameLoopTick(BASE_NOW + 1_200, mockBroadcast);
    expect(mockedStorage.getChannelState).not.toHaveBeenCalled();
  });

  it('skips cache for consecutive ticks with phase boundary', async () => {
    // When a session ends (activeSessionId cleared), the cache is invalidated
    const session = mockSession({
      scheduledEnd: new Date(BASE_NOW - 1_000),
    });

    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ activeSessionId: session.id })
    );
    mockedStorage.getSessionById.mockResolvedValue(session);
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.updateSessionStatus.mockResolvedValue(undefined as any);
    mockedStorage.upsertChannelState.mockResolvedValue(undefined as any);

    await handleGameLoopTick(BASE_NOW, mockBroadcast);

    // Cache should have been invalidated
    expect(mockedStorage.getChannelState).toHaveBeenCalled(); // First call
    // Now the next tick should re-fetch (cache was cleared)
    mockedStorage.getChannelState.mockClear();
    mockedStorage.getNextSession.mockResolvedValue(null);

    await handleGameLoopTick(BASE_NOW + 1_000, mockBroadcast);

    // Should have called getChannelState again since cache was invalidated
    expect(mockedStorage.getChannelState).toHaveBeenCalled();
  });

  // ── Logging ─────────────────────────────────────────────────────────────────

  it('logs when starting a session', async () => {
    const session = mockSession({
      scheduledStart: new Date(BASE_NOW - 60_000),
      status: 'scheduled',
    });

    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(null);
    mockedStorage.getNextSession.mockResolvedValue(session);
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.getBlocksBySessionOrdered.mockResolvedValue([mockBlock()]);
    mockedStorage.upsertChannelState.mockResolvedValue(undefined as any);
    mockedStorage.updateSessionStatus.mockResolvedValue(undefined as any);

    const { logger } = await import('./logger');

    await handleGameLoopTick(BASE_NOW, mockBroadcast);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Starting on-demand session'),
      expect.any(String),
    );
  });

  it('logs when completing a session', async () => {
    const session = mockSession({
      scheduledEnd: new Date(BASE_NOW - 1_000),
    });

    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ activeSessionId: session.id })
    );
    mockedStorage.getSessionById.mockResolvedValue(session);
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.updateSessionStatus.mockResolvedValue(undefined as any);
    mockedStorage.upsertChannelState.mockResolvedValue(undefined as any);

    const { logger } = await import('./logger');

    await handleGameLoopTick(BASE_NOW, mockBroadcast);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Ending session'),
      expect.any(String),
    );
  });

  // ── Timing Constants ────────────────────────────────────────────────────────

  it('exposes correct timing constants', () => {
    expect(READING_SEGMENT_MS).toBe(25_000);
    expect(START_BEFORE_MS).toBe(3 * 60 * 1000);
    expect(LOBBY_DELAY_MS).toBe(3 * 60 * 1000);
  });
});

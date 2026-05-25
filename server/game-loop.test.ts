import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleGameLoopTick,
  computeDecisionEndsAt,
  clearChannelCache,
  NARRATIVE_TURN_MS,
  VOTING_PHASE_MS,
  POST_VOTE_READING_MS,
} from './routes/index';
import { storage } from './storage';
import * as ai from './blocks/ai';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const { mockGenerateAndUploadImage } = vi.hoisted(() => ({
  mockGenerateAndUploadImage: vi.fn(),
}));

vi.mock('./storage', () => ({
  storage: {
    getActiveChannels: vi.fn(),
    getChannelState: vi.fn(),
    getNextSession: vi.fn(),
    getSessionById: vi.fn(),
    tryAcquireGameLock: vi.fn(),
    releaseGameLock: vi.fn(),
    createBlock: vi.fn(),
    getBlockById: vi.fn(),
    getVotesForBlock: vi.fn(),
    getRandomImage: vi.fn(),
    updateSessionStatus: vi.fn(),
    upsertChannelState: vi.fn(),
    createLore: vi.fn(),
    getPendingBlock: vi.fn(),
    deletePendingBlocksForBlock: vi.fn(),
  },
}));

vi.mock('./blocks/ai', () => ({
  generateStoryBlock: vi.fn(),
}));

vi.mock('./image-uploader', () => ({
  generateAndUploadStoryImage: (...args: unknown[]) =>
    mockGenerateAndUploadImage(...args),
}));

const mockedStorage = vi.mocked(storage);
const mockedAi = vi.mocked(ai);

// ── Helpers ─────────────────────────────────────────────────────────────────────

function mockChannel(channelId = 'scifi') {
  return { id: 1, channelId, name: 'Sci-Fi', description: '', coverImage: null, createdAt: new Date() };
}

function mockSession(overrides: Partial<any> = {}) {
  const now = Date.now();
  return {
    id: 1,
    channelId: 'scifi',
    title: 'Active Session',
    description: 'A test session',
    scheduledStart: new Date(now - 10000),
    scheduledEnd: new Date(now + 1_000_000),
    timezone: 'UTC',
    status: 'active',
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

function mockBlock(overrides: Partial<any> = {}) {
  return {
    id: 1,
    channelId: 'scifi',
    sessionId: 1,
    title: 'Test Block',
    content: 'Test content for the block',
    imageUrl: '/images/test.jpg',
    optionA: { label: 'Go Left', description: 'Venture into the unknown' },
    optionB: { label: 'Go Right', description: 'Take the safe path' },
    isNotable: false,
    embedding: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function mockChannelState(overrides: Partial<any> = {}) {
  const now = Date.now();
  return {
    channelId: 'scifi',
    currentPhase: 'reading',
    phaseEndsAt: new Date(now + 10_000),
    decisionEndsAt: new Date(now + 10_000 + 2 * NARRATIVE_TURN_MS),
    initialTimeToDecision: 2 * NARRATIVE_TURN_MS + 10_000,
    turnsToNextChoice: 2,
    currentBlockId: 1,
    activeSessionId: 1,
    processingLockedUntil: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockPendingBlock(overrides: Partial<any> = {}) {
  return {
    id: 10,
    channelId: 'scifi',
    forBlockId: 1,
    choice: 'A',
    title: 'Pregenerated Continuation',
    content: 'This was pre-generated.',
    imageUrl: '/images/pregen.jpg',
    optionA: { label: 'Opt A', description: 'Desc A' },
    optionB: { label: 'Opt B', description: 'Desc B' },
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe('computeDecisionEndsAt', () => {
  it('returns phaseEndsAt when already in voting phase', () => {
    const st = {
      currentPhase: 'voting' as const,
      phaseEndsAt: 5000,
      turnsToNextChoice: 2,
    };
    expect(computeDecisionEndsAt(st)).toBe(5000);
  });

  it('returns phaseEndsAt when in resolution phase', () => {
    const st = {
      currentPhase: 'resolution' as const,
      phaseEndsAt: 5000,
      turnsToNextChoice: 0,
    };
    expect(computeDecisionEndsAt(st)).toBe(5000);
  });

  it('returns phaseEndsAt + turns * NARRATIVE_TURN_MS + VOTING_PHASE_MS during reading with turns', () => {
    const st = {
      currentPhase: 'reading' as const,
      phaseEndsAt: 10000,
      turnsToNextChoice: 3,
    };
    expect(computeDecisionEndsAt(st)).toBe(10000 + 3 * NARRATIVE_TURN_MS + VOTING_PHASE_MS);
  });

  it('returns phaseEndsAt + VOTING_PHASE_MS when turnsToNextChoice is 0 during reading', () => {
    const st = {
      currentPhase: 'reading' as const,
      phaseEndsAt: 10000,
      turnsToNextChoice: 0,
    };
    expect(computeDecisionEndsAt(st)).toBe(10000 + VOTING_PHASE_MS);
  });
});

describe('handleGameLoopTick', () => {
  const mockBroadcast = vi.fn();
  const BASE_NOW = 1_000_000_000_000; // Fixed timestamp for deterministic tests

  beforeEach(() => {
    vi.clearAllMocks();
    clearChannelCache();
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(BASE_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Heartbeat ────────────────────────────────────────────────────────────────

  it('broadcasts heartbeat SYNC_STATE when phase has not ended', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ phaseEndsAt: new Date(BASE_NOW + 10_000) })
    );
    mockedStorage.getSessionById.mockResolvedValue(mockSession());
    mockedStorage.getBlockById.mockResolvedValue(mockBlock());
    // Clear channel cache so getChannelState is called to populate it
    clearChannelCache();

    await handleGameLoopTick(BASE_NOW + 5_000, mockBroadcast);

    expect(mockBroadcast).toHaveBeenCalledWith('scifi', expect.objectContaining({
      type: 'SYNC_STATE',
      payload: expect.objectContaining({
        timeRemaining: 5_000,
        phaseInitialMs: expect.any(Number),
      }),
    }));
  });

  // ── Narrative Turn ───────────────────────────────────────────────────────────

  it('performs narrative turn: decrements turns and stays in reading', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ phaseEndsAt: new Date(BASE_NOW + 1_000), turnsToNextChoice: 2 })
    );
    mockedStorage.getSessionById.mockResolvedValue(mockSession());
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.getBlockById.mockResolvedValue(mockBlock());
    mockedStorage.createBlock.mockResolvedValue(mockBlock({ id: 2, title: 'New Block' }));
    mockedStorage.getPendingBlock.mockResolvedValue(null); // No pregenerated
    mockedAi.generateStoryBlock.mockResolvedValue({
      title: 'Narrative Turn',
      content: 'New story content...',
      optionA: { label: 'A', description: 'desc A' },
      optionB: { label: 'B', description: 'desc B' },
    });
    mockGenerateAndUploadImage.mockResolvedValue('/images/new.jpg');

    await handleGameLoopTick(BASE_NOW + 2_000, mockBroadcast);

    // Should have upserted state with decremented turns
    const upsertCalls = mockedStorage.upsertChannelState.mock.calls;
    const lastUpsert = upsertCalls[upsertCalls.length - 1];
    expect(lastUpsert[1].turnsToNextChoice).toBe(1);

    // Should have created a new block
    expect(mockedStorage.createBlock).toHaveBeenCalled();

    // Broadcast should include new phase state
    expect(mockBroadcast).toHaveBeenCalledWith('scifi', expect.objectContaining({
      type: 'SYNC_STATE',
      payload: expect.objectContaining({
        turnsToNextChoice: 1,
      }),
    }));
  });

  it('uses pregenerated pending block when available for narrative turn', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ phaseEndsAt: new Date(BASE_NOW + 1_000), turnsToNextChoice: 1 })
    );
    mockedStorage.getSessionById.mockResolvedValue(mockSession());
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.getBlockById.mockResolvedValue(mockBlock());
    mockedStorage.getPendingBlock.mockResolvedValue(mockPendingBlock());

    await handleGameLoopTick(BASE_NOW + 2_000, mockBroadcast);

    // Should NOT have called AI since pending block exists
    expect(mockedAi.generateStoryBlock).not.toHaveBeenCalled();
    // Should have used pending block data
    expect(mockedStorage.createBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Pregenerated Continuation',
        content: 'This was pre-generated.',
      })
    );
    // Should clean up pending blocks
    expect(mockedStorage.deletePendingBlocksForBlock).toHaveBeenCalledWith(1);
  });

  it('falls back to inline generation when pregeneration is missing', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ phaseEndsAt: new Date(BASE_NOW + 1_000), turnsToNextChoice: 1 })
    );
    mockedStorage.getSessionById.mockResolvedValue(mockSession());
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.getBlockById.mockResolvedValue(mockBlock());
    mockedStorage.getPendingBlock.mockResolvedValue(null);
    mockedAi.generateStoryBlock.mockResolvedValue({
      title: 'Inline Fallback',
      content: 'Generated inline.',
      optionA: { label: 'A', description: 'desc A' },
      optionB: { label: 'B', description: 'desc B' },
    });
    mockGenerateAndUploadImage.mockResolvedValue('/images/inline.jpg');

    await handleGameLoopTick(BASE_NOW + 2_000, mockBroadcast);

    expect(mockedAi.generateStoryBlock).toHaveBeenCalled();
    expect(mockedStorage.createBlock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Inline Fallback' })
    );
  });

  it('releases game lock in finally block after narrative turn', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ phaseEndsAt: new Date(BASE_NOW + 1_000), turnsToNextChoice: 1 })
    );
    mockedStorage.getSessionById.mockResolvedValue(mockSession());
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.getBlockById.mockResolvedValue(mockBlock());
    mockedStorage.getPendingBlock.mockResolvedValue(null);
    mockedAi.generateStoryBlock.mockResolvedValue({
      title: 'Test', content: 'Content',
      optionA: { label: 'A', description: 'd' },
      optionB: { label: 'B', description: 'd' },
    });
    mockGenerateAndUploadImage.mockResolvedValue('/images/x.jpg');

    await handleGameLoopTick(BASE_NOW + 2_000, mockBroadcast);

    expect(mockedStorage.releaseGameLock).toHaveBeenCalledWith('scifi');
  });

  // ── Enter Voting Phase ──────────────────────────────────────────────────────

  it('enters voting phase when turnsToNextChoice reaches 0', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({
        phaseEndsAt: new Date(BASE_NOW + 1_000),
        turnsToNextChoice: 0,
      })
    );
    mockedStorage.getSessionById.mockResolvedValue(mockSession());
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.getBlockById.mockResolvedValue(mockBlock());

    await handleGameLoopTick(BASE_NOW + 2_000, mockBroadcast);

    // Should have upserted state to voting phase
    const upsertCalls = mockedStorage.upsertChannelState.mock.calls;
    const lastUpsert = upsertCalls[upsertCalls.length - 1];
    expect(lastUpsert[1].currentPhase).toBe('voting');

    // Broadcast should indicate voting phase
    expect(mockBroadcast).toHaveBeenCalledWith('scifi', expect.objectContaining({
      type: 'SYNC_STATE',
      payload: expect.objectContaining({
        phase: 'voting',
        phaseInitialMs: VOTING_PHASE_MS,
      }),
    }));
  });

  it('includes both decision timer and phase timer in voting entry broadcast', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({
        phaseEndsAt: new Date(BASE_NOW + 1_000),
        turnsToNextChoice: 0,
      })
    );
    mockedStorage.getSessionById.mockResolvedValue(mockSession());
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.getBlockById.mockResolvedValue(mockBlock());

    await handleGameLoopTick(BASE_NOW + 2_000, mockBroadcast);

    const payload = mockBroadcast.mock.calls.find(
      (c: any[]) => c[1].type === 'SYNC_STATE'
    )?.[1].payload;
    expect(payload.timeRemaining).toBe(VOTING_PHASE_MS);
    expect(payload.timeToNextDecision).toBe(VOTING_PHASE_MS);
    expect(payload.phaseInitialMs).toBe(VOTING_PHASE_MS);
  });

  // ── Vote Tally ──────────────────────────────────────────────────────────────

  it('tallies votes after voting phase ends and creates lore', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({
        currentPhase: 'voting',
        phaseEndsAt: new Date(BASE_NOW + 1_000),
        turnsToNextChoice: 0,
      })
    );
    mockedStorage.getSessionById.mockResolvedValue(mockSession());
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.getBlockById.mockResolvedValue(mockBlock());
    mockedStorage.getVotesForBlock.mockResolvedValue([
      { choice: 'A', userId: '1' },
      { choice: 'A', userId: '2' },
      { choice: 'B', userId: '3' },
    ] as any);
    mockedStorage.getPendingBlock.mockResolvedValue(null); // No pregen
    mockedAi.generateStoryBlock.mockResolvedValue({
      title: 'Post-Vote',
      content: 'After the vote...',
      optionA: { label: 'Next A', description: 'desc A' },
      optionB: { label: 'Next B', description: 'desc B' },
    });
    mockGenerateAndUploadImage.mockResolvedValue('/images/postvote.jpg');

    await handleGameLoopTick(BASE_NOW + 2_000, mockBroadcast);

    // Should have tallied votes
    expect(mockedStorage.getVotesForBlock).toHaveBeenCalledWith(1);

    // Should have created a lore entry for the vote outcome
    expect(mockedStorage.createLore).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'scifi',
        content: expect.stringContaining('"Go Left" won'),
      })
    );

    // Should have transitioned back to reading
    const upsertCalls = mockedStorage.upsertChannelState.mock.calls;
    const lastUpsert = upsertCalls[upsertCalls.length - 1];
    expect(lastUpsert[1].currentPhase).toBe('reading');
    expect(lastUpsert[1].turnsToNextChoice).toBeGreaterThanOrEqual(2);
    expect(lastUpsert[1].turnsToNextChoice).toBeLessThanOrEqual(4);

    // Broadcast should show post-vote reading phase
    expect(mockBroadcast).toHaveBeenCalledWith('scifi', expect.objectContaining({
      type: 'SYNC_STATE',
      payload: expect.objectContaining({
        currentPhase: 'reading',
        phaseInitialMs: POST_VOTE_READING_MS,
      }),
    }));
  });

  it('creates lore with correct winner info after vote tally', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({
        currentPhase: 'voting',
        phaseEndsAt: new Date(BASE_NOW + 1_000),
        turnsToNextChoice: 0,
        currentBlockId: 1,
      })
    );
    mockedStorage.getSessionById.mockResolvedValue(mockSession());
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.getBlockById.mockResolvedValue(
      mockBlock({
        title: 'The Crossroads',
        optionA: { label: 'Left Path', description: 'Go left' },
        optionB: { label: 'Right Path', description: 'Go right' },
      })
    );
    // B wins
    mockedStorage.getVotesForBlock.mockResolvedValue([
      { choice: 'A', userId: '1' },
      { choice: 'B', userId: '2' },
      { choice: 'B', userId: '3' },
    ] as any);
    mockedStorage.getPendingBlock.mockResolvedValue(mockPendingBlock({ choice: 'B' }));

    await handleGameLoopTick(BASE_NOW + 2_000, mockBroadcast);

    expect(mockedStorage.createLore).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'scifi',
        content: expect.stringContaining('"Right Path" won'),
      })
    );
  });

  // ── Resolution Phase ────────────────────────────────────────────────────────

  it('enters resolution phase when session scheduled end is reached', async () => {
    const now = BASE_NOW;
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ phaseEndsAt: new Date(now + 1_000) })
    );
    mockedStorage.getSessionById.mockResolvedValue(
      mockSession({ scheduledEnd: new Date(now - 1_000) }) // Past end
    );
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.getBlockById.mockResolvedValue(mockBlock());
    mockedAi.generateStoryBlock.mockResolvedValue({
      title: 'Resolution',
      content: 'The story concludes...',
    });
    mockGenerateAndUploadImage.mockResolvedValue('/images/res.jpg');

    await handleGameLoopTick(now, mockBroadcast);

    // Should have upserted to resolution
    const upsertCalls = mockedStorage.upsertChannelState.mock.calls;
    const lastUpsert = upsertCalls[upsertCalls.length - 1];
    expect(lastUpsert[1].currentPhase).toBe('resolution');

    // Broadcast should indicate resolution
    expect(mockBroadcast).toHaveBeenCalledWith('scifi', expect.objectContaining({
      type: 'SYNC_STATE',
      payload: expect.objectContaining({
        phase: 'resolution',
        phaseInitialMs: 60_000,
      }),
    }));
  });

  it('completes session after resolution phase ends', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({
        currentPhase: 'resolution',
        phaseEndsAt: new Date(BASE_NOW - 1_000), // Past end
      })
    );
    mockedStorage.getSessionById.mockResolvedValue(
      mockSession({ scheduledEnd: new Date(BASE_NOW - 10_000) })
    );
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);

    await handleGameLoopTick(BASE_NOW, mockBroadcast);

    expect(mockedStorage.updateSessionStatus).toHaveBeenCalledWith(1, 'completed');
    expect(mockBroadcast).toHaveBeenCalledWith('scifi', expect.objectContaining({
      type: 'SESSION_STATUS',
      payload: { status: 'completed', session: expect.any(Object) },
    }));
  });

  // ── Session Start ───────────────────────────────────────────────────────────

  it('starts a new session when scheduled time is reached', async () => {
    const now = BASE_NOW;
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    // No cached state - no active session
    mockedStorage.getChannelState.mockResolvedValue(null);
    // But there is a next session
    mockedStorage.getNextSession.mockResolvedValue(
      mockSession({
        scheduledStart: new Date(now - 60_000), // Started 1 min ago
        scheduledEnd: new Date(now + 1_000_000),
      })
    );
    // For startSessionForChannelId internals
    mockedStorage.getCurrentBlock = vi.fn().mockResolvedValue(null);
    mockedStorage.getLastBlock = vi.fn().mockResolvedValue(null);
    mockedStorage.createBlock = vi.fn().mockResolvedValue(mockBlock());
    mockedStorage.getRandomImage = vi.fn().mockResolvedValue('/images/default.jpg');
    mockedStorage.tryAcquireGameLock = vi.fn().mockResolvedValue(true);

    // Need to mock AI for creating initial block
    mockedAi.generateStoryBlock.mockResolvedValue({
      title: 'Initial Block',
      content: 'Once upon a time...',
      optionA: { label: 'Door A', description: 'Open door A' },
      optionB: { label: 'Door B', description: 'Open door B' },
    });
    mockGenerateAndUploadImage.mockResolvedValue('/images/initial.jpg');

    await handleGameLoopTick(now, mockBroadcast);

    // Should have created a session and upserted channel state
    expect(mockedStorage.upsertChannelState).toHaveBeenCalledWith(
      'scifi',
      expect.objectContaining({ currentPhase: 'reading' })
    );
  });

  // ── Lock Contention ─────────────────────────────────────────────────────────

  it('skips phase transition when lock is not acquired', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ phaseEndsAt: new Date(BASE_NOW + 1_000) })
    );
    mockedStorage.getSessionById.mockResolvedValue(mockSession());
    // Lock not acquired
    mockedStorage.tryAcquireGameLock.mockResolvedValue(false);

    await handleGameLoopTick(BASE_NOW + 2_000, mockBroadcast);

    // Should not have upserted anything or created blocks
    expect(mockedStorage.upsertChannelState).not.toHaveBeenCalled();
    expect(mockedStorage.createBlock).not.toHaveBeenCalled();
    expect(mockedStorage.releaseGameLock).not.toHaveBeenCalled();
  });

  it('releases lock even when transition throws', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ phaseEndsAt: new Date(BASE_NOW + 1_000), turnsToNextChoice: 1 })
    );
    mockedStorage.getSessionById.mockResolvedValue(mockSession());
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.getBlockById.mockResolvedValue(mockBlock());
    mockedStorage.getPendingBlock.mockRejectedValue(new Error('DB error'));

    // Should not throw - catch block handles it
    await expect(
      handleGameLoopTick(BASE_NOW + 2_000, mockBroadcast)
    ).resolves.not.toThrow();

    // But lock should still be released
    expect(mockedStorage.releaseGameLock).toHaveBeenCalledWith('scifi');
  });

  // ── Image Generation Failures ───────────────────────────────────────────────

  it('uses fallback image when AI image generation fails in narrative turn', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ phaseEndsAt: new Date(BASE_NOW + 1_000), turnsToNextChoice: 1 })
    );
    mockedStorage.getSessionById.mockResolvedValue(mockSession());
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.getBlockById.mockResolvedValue(mockBlock());
    mockedStorage.getPendingBlock.mockResolvedValue(null);
    mockedAi.generateStoryBlock.mockResolvedValue({
      title: 'No Image Block',
      content: 'Text only...',
      optionA: { label: 'A', description: 'd' },
      optionB: { label: 'B', description: 'd' },
    });
    mockGenerateAndUploadImage.mockRejectedValue(new Error('AI down'));
    mockedStorage.getRandomImage.mockResolvedValue('/images/fallback.jpg');

    await handleGameLoopTick(BASE_NOW + 2_000, mockBroadcast);

    expect(mockedStorage.createBlock).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: '/images/fallback.jpg' })
    );
  });

  it('uses hardcoded fallback when randomImage also fails', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ phaseEndsAt: new Date(BASE_NOW + 1_000), turnsToNextChoice: 1 })
    );
    mockedStorage.getSessionById.mockResolvedValue(mockSession());
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);
    mockedStorage.getBlockById.mockResolvedValue(mockBlock());
    mockedStorage.getPendingBlock.mockResolvedValue(null);
    mockedAi.generateStoryBlock.mockResolvedValue({
      title: 'No Image',
      content: 'Text only...',
      optionA: { label: 'A', description: 'd' },
      optionB: { label: 'B', description: 'd' },
    });
    mockGenerateAndUploadImage.mockRejectedValue(new Error('AI down'));
    mockedStorage.getRandomImage.mockResolvedValue(null);

    await handleGameLoopTick(BASE_NOW + 2_000, mockBroadcast);

    expect(mockedStorage.createBlock).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: '/images/img_1771936309521_ieycq2.jpg' })
    );
  });

  // ── Channel Cache ───────────────────────────────────────────────────────────

  it('uses cached channel state on subsequent ticks', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({ phaseEndsAt: new Date(BASE_NOW + 10_000) })
    );
    mockedStorage.getSessionById.mockResolvedValue(mockSession());

    // First tick - should call getChannelState (cache miss)
    await handleGameLoopTick(BASE_NOW + 1_000, mockBroadcast);
    expect(mockedStorage.getChannelState).toHaveBeenCalledTimes(1);

    mockedStorage.getChannelState.mockClear();

    // Second tick soon after - should use cache
    await handleGameLoopTick(BASE_NOW + 1_200, mockBroadcast);
    expect(mockedStorage.getChannelState).not.toHaveBeenCalled();
  });

  // ── Stale Session Handling ──────────────────────────────────────────────────

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

  it('does not produce lore resolve error when currentBlock is missing at tally time', async () => {
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({
        currentPhase: 'voting',
        phaseEndsAt: new Date(BASE_NOW + 1_000),
        currentBlockId: null, // No current block
      })
    );
    mockedStorage.getSessionById.mockResolvedValue(mockSession());
    mockedStorage.tryAcquireGameLock.mockResolvedValue(true);

    await handleGameLoopTick(BASE_NOW + 2_000, mockBroadcast);

    // Should not have called createLore when currentBlock is null
    expect(mockedStorage.createLore).not.toHaveBeenCalled();
  });

  // ── Timing Constants ────────────────────────────────────────────────────────

  it('uses correct timing constants for each phase', () => {
    expect(NARRATIVE_TURN_MS).toBe(40_000);
    expect(VOTING_PHASE_MS).toBe(40_000);
    expect(POST_VOTE_READING_MS).toBe(40_000);
  });

  it('phase initial times use correct constants', async () => {
    // Phase durations are sent as phaseInitialMs in SYNC_STATE broadcasts
    mockedStorage.getActiveChannels.mockResolvedValue([mockChannel()]);
    mockedStorage.getChannelState.mockResolvedValue(
      mockChannelState({
        currentPhase: 'reading',
        phaseEndsAt: new Date(BASE_NOW + 10_000),
        turnsToNextChoice: 1,
      })
    );
    mockedStorage.getSessionById.mockResolvedValue(mockSession());

    await handleGameLoopTick(BASE_NOW + 5_000, mockBroadcast);

    const payload = mockBroadcast.mock.calls.find(
      (c: any[]) => c[1].type === 'SYNC_STATE'
    )?.[1].payload;
    expect(payload.phaseInitialMs).toBe(NARRATIVE_TURN_MS);
  });
});

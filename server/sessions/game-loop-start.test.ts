import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGameLoopTick, START_BEFORE_MS } from '../routes';
import { storage } from '../storage';

vi.mock('../storage', () => ({
    storage: {
        getActiveChannels: vi.fn(),
        getChannelState: vi.fn(),
        getNextSession: vi.fn(),
        getSessionById: vi.fn(),
        upsertChannelState: vi.fn(),
        tryAcquireGameLock: vi.fn().mockResolvedValue(true),
        releaseGameLock: vi.fn().mockResolvedValue(undefined),
        getCurrentBlock: vi.fn(),
        getLastBlock: vi.fn(),
        createBlock: vi.fn(),
        updateSessionStatus: vi.fn(),
    },
}));

const mockedStorage = vi.mocked(storage);

describe('Game Loop Session Start', () => {
    const mockBroadcast = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('starts session when within START_BEFORE_MS window', async () => {
        const now = Date.now();
        const sessionStartTime = now + START_BEFORE_MS - 1000;
        
        mockedStorage.getActiveChannels.mockResolvedValue([
            { channelId: 'scifi', name: 'Sci-Fi' }
        ]);
        
        mockedStorage.getChannelState.mockResolvedValue({
            channelId: 'scifi',
            activeSessionId: null,
            currentBlockId: null,
            currentPhase: null,
            phaseEndsAt: null,
            decisionEndsAt: null,
            initialTimeToDecision: null,
            turnsToNextChoice: null,
        });
        
        mockedStorage.getNextSession.mockResolvedValue({
            id: 1,
            channelId: 'scifi',
            title: 'Test Session',
            scheduledStart: new Date(sessionStartTime),
            scheduledEnd: new Date(sessionStartTime + 30 * 60 * 1000),
            status: 'scheduled',
        } as any);
        
        mockedStorage.getCurrentBlock.mockResolvedValue(null);
        mockedStorage.getLastBlock.mockResolvedValue(null);
        mockedStorage.createBlock.mockResolvedValue({
            id: 1,
            channelId: 'scifi',
            title: 'Test Block',
            content: 'Test content',
            optionA: { label: 'A', description: 'Option A' },
            optionB: { label: 'B', description: 'Option B' },
        } as any);
        
        await handleGameLoopTick(now, mockBroadcast);
        
        expect(mockedStorage.updateSessionStatus).toHaveBeenCalledWith(1, 'active');
        expect(mockBroadcast).toHaveBeenCalledWith('scifi', expect.objectContaining({
            type: 'SESSION_STATUS',
            payload: expect.objectContaining({ status: 'active' }),
        }));
    });

    it('does not start session when more than START_BEFORE_MS away', async () => {
        const now = Date.now();
        const sessionStartTime = now + START_BEFORE_MS + 60000;
        
        mockedStorage.getActiveChannels.mockResolvedValue([
            { channelId: 'scifi', name: 'Sci-Fi' }
        ]);
        
        mockedStorage.getChannelState.mockResolvedValue({
            channelId: 'scifi',
            activeSessionId: null,
            currentBlockId: null,
            currentPhase: null,
            phaseEndsAt: null,
            decisionEndsAt: null,
            initialTimeToDecision: null,
            turnsToNextChoice: null,
        });
        
        mockedStorage.getNextSession.mockResolvedValue({
            id: 1,
            channelId: 'scifi',
            title: 'Test Session',
            scheduledStart: new Date(sessionStartTime),
            scheduledEnd: new Date(sessionStartTime + 30 * 60 * 1000),
            status: 'scheduled',
        } as any);
        
        await handleGameLoopTick(now, mockBroadcast);
        
        expect(mockedStorage.updateSessionStatus).not.toHaveBeenCalled();
        expect(mockBroadcast).not.toHaveBeenCalled();
    });

    it('skips starting session if lock cannot be acquired', async () => {
        const now = Date.now();
        const sessionStartTime = now + START_BEFORE_MS - 1000;
        
        mockedStorage.getActiveChannels.mockResolvedValue([
            { channelId: 'scifi', name: 'Sci-Fi' }
        ]);
        
        mockedStorage.getChannelState.mockResolvedValue({
            channelId: 'scifi',
            activeSessionId: null,
            currentBlockId: null,
        });
        
        mockedStorage.getNextSession.mockResolvedValue({
            id: 1,
            channelId: 'scifi',
            title: 'Test Session',
            scheduledStart: new Date(sessionStartTime),
            scheduledEnd: new Date(sessionStartTime + 30 * 60 * 1000),
            status: 'scheduled',
        } as any);
        
        mockedStorage.tryAcquireGameLock.mockResolvedValue(false);
        
        await handleGameLoopTick(now, mockBroadcast);
        
        expect(mockedStorage.updateSessionStatus).not.toHaveBeenCalled();
    });
});

describe('START_BEFORE_MS constant', () => {
    it('is set to 3 minutes in milliseconds', () => {
        expect(START_BEFORE_MS).toBe(3 * 60 * 1000);
    });
});
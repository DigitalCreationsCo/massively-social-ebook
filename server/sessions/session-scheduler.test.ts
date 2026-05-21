import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGameLoopTick } from '../routes';
import { storage } from '../storage';
import * as ai from '../blocks/ai';

vi.mock('../storage', () => ({
    storage: {
        getCurrentBlock: vi.fn(),
        createBlock: vi.fn(),
        getVotesForBlock: vi.fn(),
        getRandomImage: vi.fn(),
        getNextSession: vi.fn(),
        getActiveSession: vi.fn(),
        updateSessionStatus: vi.fn(),
    },
}));

vi.mock('../blocks/ai', () => ({
    generateStoryBlock: vi.fn(),
    generateStoryImage: vi.fn(),
}));

const mockStorage = vi.mocked(storage);
const mockAi = vi.mocked(ai);

describe('Session Scheduler Engine (Game Loop Integration)', () => {
    const mockBroadcastFn = vi.fn();
    const timeNowMock = Date.now();

    beforeEach(() => {
        vi.clearAllMocks();
        state.scifi = {
            currentPhase: 'reading',
            phaseEndsAt: timeNowMock + 10000,
            decisionEndsAt: timeNowMock + 20000,
            initialTimeToDecision: 20000,
            currentBlock: undefined,
            turnsToNextChoice: 2,
            activeSession: undefined,
        };
        state.mystery = {
            currentPhase: 'reading',
            phaseEndsAt: timeNowMock + 10000,
            decisionEndsAt: timeNowMock + 20000,
            initialTimeToDecision: 20000,
            currentBlock: undefined,
            turnsToNextChoice: 2,
            activeSession: undefined,
        };
    });

    it('bypasses game loop execution when no session is active or scheduled', async () => {
        mockStorage.getNextSession.mockResolvedValue(null);

        await handleGameLoopTick(timeNowMock, mockBroadcastFn);

        expect(mockBroadcastFn).not.toHaveBeenCalled();
        expect(mockStorage.getCurrentBlock).not.toHaveBeenCalled();
    });

    it('spawns a new session and provisions initial block upon scheduled start threshold', async () => {
        const timeScheduledMock = timeNowMock - 1000;
        const sessionMockStarting = {
            id: 10,
            channelId: 'scifi',
            title: 'Starting Soon',
            scheduledStart: new Date(timeScheduledMock),
            scheduledEnd: new Date(timeNowMock + 3600000),
            status: 'scheduled'
        } as any;

        mockStorage.getNextSession.mockResolvedValue(sessionMockStarting);
        mockStorage.getCurrentBlock.mockResolvedValue(null);
        mockAi.generateStoryBlock.mockResolvedValue({
            title: 'Initial Block',
            content: 'The story begins.',
            optionA: { label: 'A', description: 'desc A' },
            optionB: { label: 'B', description: 'desc B' },
        });
        mockAi.generateStoryImage.mockResolvedValue('img.jpg');
        mockStorage.createBlock.mockResolvedValue({ id: 1, content: '...', title: '...', channelId: 'scifi' } as any);

        await handleGameLoopTick(timeNowMock, mockBroadcastFn);

        expect(state.scifi.activeSession).toEqual(sessionMockStarting);
        expect(mockStorage.updateSessionStatus).toHaveBeenCalledWith(10, 'active');
        expect(mockBroadcastFn).toHaveBeenCalledWith('scifi', expect.objectContaining({
            type: 'SESSION_STATUS',
            payload: { status: 'active', session: sessionMockStarting }
        }));
    });

    it('transitions state to resolution phase upon reaching scheduled termination bound', async () => {
        const timeEndMock = timeNowMock - 1000;
        const sessionMockEnding = {
            id: 11,
            channelId: 'mystery',
            title: 'Ending Now',
            scheduledStart: new Date(timeNowMock - 7200000),
            scheduledEnd: new Date(timeEndMock),
            status: 'active'
        } as any;

        state.mystery.activeSession = sessionMockEnding;
        state.mystery.currentBlock = { id: 10, content: '...', channelId: 'mystery' } as any;

        mockAi.generateStoryBlock.mockResolvedValue({ title: 'The End', content: 'Cliffhanger...' } as any);
        mockAi.generateStoryImage.mockResolvedValue('img.jpg');
        mockStorage.createBlock.mockResolvedValue({ id: 11, content: '...', title: '...', channelId: 'mystery' } as any);

        await handleGameLoopTick(timeNowMock, mockBroadcastFn);

        expect(state.mystery.activeSession).toBeDefined();
        expect(state.mystery.currentPhase).toBe('resolution');
        expect(mockBroadcastFn).toHaveBeenCalledWith('mystery', expect.objectContaining({
            type: 'SYNC_STATE',
            payload: expect.objectContaining({ phase: 'resolution' })
        }));
    });
});
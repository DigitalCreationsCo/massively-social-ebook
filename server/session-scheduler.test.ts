import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGameLoopTick, state } from './routes';
import { storage } from './storage';
import * as ai from './ai';

// Mock storage and AI
vi.mock('./storage', () => ({
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

vi.mock('./ai', () => ({
    generateStoryBlock: vi.fn(),
    generateStoryImage: vi.fn(),
}));

const mockedStorage = vi.mocked(storage);
const mockedAi = vi.mocked(ai);

describe('Session Scheduler (Game Loop integration)', () => {
    const mockBroadcast = vi.fn();
    const now = Date.now();

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset state for test subjects
        state.scifi = {
            currentPhase: 'reading',
            phaseEndsAt: now + 10000,
            decisionEndsAt: now + 20000,
            initialTimeToDecision: 20000,
            currentBlock: undefined,
            turnsToNextChoice: 2,
            activeSession: undefined,
        };
        state.mystery = {
            currentPhase: 'reading',
            phaseEndsAt: now + 10000,
            decisionEndsAt: now + 20000,
            initialTimeToDecision: 20000,
            currentBlock: undefined,
            turnsToNextChoice: 2,
            activeSession: undefined,
        };
    });

    it('skips game loop logic when no session is active and no session is starting', async () => {
        mockedStorage.getNextSession.mockResolvedValue(null);

        await handleGameLoopTick(now, mockBroadcast);

        expect(mockBroadcast).not.toHaveBeenCalled();
        expect(mockedStorage.getCurrentBlock).not.toHaveBeenCalled();
    });

    it('starts a session when a scheduled session start time is reached', async () => {
        const scheduledTime = now - 1000; // Started 1s ago
        const mockSession = {
            id: 10,
            channelId: 'scifi',
            title: 'Starting Soon',
            scheduledStart: new Date(scheduledTime),
            scheduledEnd: new Date(now + 3600000), // Ends in 1h
            status: 'scheduled'
        } as any;

        mockedStorage.getNextSession.mockResolvedValue(mockSession);
        mockedStorage.getCurrentBlock.mockResolvedValue(null); // Force seeding
        mockedAi.generateStoryBlock.mockResolvedValue({
            title: 'Initial Block',
            content: 'The story begins.',
            optionA: { label: 'A', description: 'desc A' },
            optionB: { label: 'B', description: 'desc B' },
        });
        mockedAi.generateStoryImage.mockResolvedValue('img.jpg');
        mockedStorage.createBlock.mockResolvedValue({ id: 1, content: '...', title: '...', channelId: 'scifi' } as any);

        await handleGameLoopTick(now, mockBroadcast);

        expect(state.scifi.activeSession).toEqual(mockSession);
        expect(mockedStorage.updateSessionStatus).toHaveBeenCalledWith(10, 'active');
        expect(mockBroadcast).toHaveBeenCalledWith('scifi', expect.objectContaining({
            type: 'SESSION_STATUS',
            payload: { status: 'active', session: mockSession }
        }));
    });

    it('transitions to resolution phase when the scheduled end time is reached', async () => {
        const endTime = now - 1000; // Ended 1s ago
        const mockSession = {
            id: 11,
            channelId: 'mystery',
            title: 'Ending Now',
            scheduledStart: new Date(now - 7200000),
            scheduledEnd: new Date(endTime),
            status: 'active'
        } as any;

        state.mystery.activeSession = mockSession;
        state.mystery.currentBlock = { id: 10, content: '...', channelId: 'mystery' } as any;

        mockedAi.generateStoryBlock.mockResolvedValue({
            title: 'The End',
            content: 'Cliffhanger...',
        } as any);
        mockedAi.generateStoryImage.mockResolvedValue('img.jpg');
        mockedStorage.createBlock.mockResolvedValue({ id: 11, content: '...', title: '...', channelId: 'mystery' } as any);

        await handleGameLoopTick(now, mockBroadcast);

        expect(state.mystery.activeSession).toBeDefined();
        expect(state.mystery.currentPhase).toBe('resolution');
        expect(mockBroadcast).toHaveBeenCalledWith('mystery', expect.objectContaining({
            type: 'SYNC_STATE',
            payload: expect.objectContaining({ phase: 'resolution' })
        }));
    });

    it('completes session after resolution phase duration ends', async () => {
        const mockSession = {
            id: 11,
            title: 'Ending',
            scheduledEnd: new Date(now - 2000)
        } as any;
        state.mystery.activeSession = mockSession;
        state.mystery.currentPhase = 'resolution';
        state.mystery.phaseEndsAt = now - 1000; // Resolution ended

        await handleGameLoopTick(now, mockBroadcast);

        expect(state.mystery.activeSession).toBeUndefined();
        expect(mockedStorage.updateSessionStatus).toHaveBeenCalledWith(11, 'completed');
        expect(mockBroadcast).toHaveBeenCalledWith('mystery', expect.objectContaining({
            type: 'SESSION_STATUS',
            payload: { status: 'completed', session: mockSession }
        }));
    });

    it('continues normal game loop if session is active', async () => {
        const mockSession = {
            id: 12,
            channelId: 'scifi',
            title: 'Ongoing',
            scheduledStart: new Date(now - 3600000),
            scheduledEnd: new Date(now + 3600000),
            status: 'active'
        } as any;

        state.scifi.activeSession = mockSession;
        state.scifi.currentBlock = { id: 100 } as any;
        state.scifi.phaseEndsAt = now + 5000; // 5s remaining

        await handleGameLoopTick(now, mockBroadcast);

        // Should broadcast SYNC_STATE (progress update) but not advance blocks
        expect(mockBroadcast).toHaveBeenCalledWith('scifi', expect.objectContaining({
            type: 'SYNC_STATE',
            payload: expect.objectContaining({
                timeRemaining: 5000
            })
        }));
    });
});

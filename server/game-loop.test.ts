import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGameLoopTick, state, computeDecisionEndsAt, NARRATIVE_TURN_MS, VOTING_PHASE_MS, POST_VOTE_READING_MS } from './routes';
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

describe('computeDecisionEndsAt', () => {
    it('returns phaseEndsAt when already in voting phase', () => {
        const st = {
            currentPhase: 'voting' as const,
            phaseEndsAt: 5000,
            decisionEndsAt: 0,
            initialTimeToDecision: 0,
            currentBlock: undefined,
            turnsToNextChoice: 2,
        };
        expect(computeDecisionEndsAt(st)).toBe(5000);
    });

    it('returns phaseEndsAt + turnsToNextChoice * NARRATIVE_TURN_MS during reading', () => {
        const st = {
            currentPhase: 'reading' as const,
            phaseEndsAt: 10000,
            decisionEndsAt: 0,
            initialTimeToDecision: 0,
            currentBlock: undefined,
            turnsToNextChoice: 3,
        };
        expect(computeDecisionEndsAt(st)).toBe(10000 + 3 * NARRATIVE_TURN_MS);
    });

    it('returns phaseEndsAt when turnsToNextChoice is 0 during reading', () => {
        const st = {
            currentPhase: 'reading' as const,
            phaseEndsAt: 10000,
            decisionEndsAt: 0,
            initialTimeToDecision: 0,
            currentBlock: undefined,
            turnsToNextChoice: 0,
        };
        expect(computeDecisionEndsAt(st)).toBe(10000);
    });
});

describe('handleGameLoopTick', () => {
    const mockBroadcast = vi.fn();
    const now = Date.now();

    beforeEach(() => {
        vi.clearAllMocks();
        // Setup initial state for a channel
        state.scifi = {
            currentPhase: 'reading',
            phaseEndsAt: now + 1000,
            decisionEndsAt: now + 1000 + 2 * NARRATIVE_TURN_MS,
            initialTimeToDecision: 2 * NARRATIVE_TURN_MS + 1000,
            currentBlock: { id: 1, content: 'Test content', title: 'Test', channelId: 'scifi', createdAt: new Date() } as any,
            turnsToNextChoice: 2,
            activeSession: {
                id: 1,
                channelId: 'scifi',
                title: 'Active Session',
                scheduledStart: new Date(now - 10000),
                scheduledEnd: new Date(now + 1000000),
                status: 'active'
            } as any,
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
        // Default mock for createBlock to avoid undefined currentBlock
        mockedStorage.createBlock.mockImplementation(async (data: any) => ({ ...data, id: Math.random() }));
        mockedStorage.getNextSession.mockResolvedValue(null);
    });

    it('decrements turnsToNextChoice and stays in reading phase during a narrative turn', async () => {
        mockedAi.generateStoryBlock.mockResolvedValue({
            title: 'Next Narrative',
            content: 'More story...',
            optionA: { label: 'A', description: 'desc A' },
            optionB: { label: 'B', description: 'desc B' },
        });
        mockedAi.generateStoryImage.mockResolvedValue('http://image.jpg');

        // Trigger tick after phase ends
        await handleGameLoopTick(now + 2000, mockBroadcast);

        expect(state.scifi.turnsToNextChoice).toBe(1);
        expect(state.scifi.currentPhase).toBe('reading');
        expect(mockedStorage.createBlock).toHaveBeenCalled();
        expect(mockBroadcast).toHaveBeenCalledWith('scifi', expect.objectContaining({
            type: 'SYNC_STATE',
            payload: expect.objectContaining({
                turnsToNextChoice: 1,
                phase: 'reading'
            })
        }));
    });

    it('enters voting phase when turnsToNextChoice is 0 and phase ends', async () => {
        state.scifi.turnsToNextChoice = 0;
        state.scifi.phaseEndsAt = now + 1000;

        await handleGameLoopTick(now + 2000, mockBroadcast);

        expect(state.scifi.currentPhase).toBe('voting');
        expect(state.scifi.turnsToNextChoice).toBe(0);
        expect(mockBroadcast).toHaveBeenCalledWith('scifi', expect.objectContaining({
            type: 'SYNC_STATE',
            payload: expect.objectContaining({
                phase: 'voting'
            })
        }));
    });

    it('tallies votes and resets turnsToNextChoice after voting phase', async () => {
        state.scifi.currentPhase = 'voting';
        state.scifi.phaseEndsAt = now + 1000;
        mockedStorage.getVotesForBlock.mockResolvedValue([
            { choice: 'A', userId: '1' },
            { choice: 'A', userId: '2' },
            { choice: 'B', userId: '3' },
        ] as any);
        mockedAi.generateStoryBlock.mockResolvedValue({
            title: 'Voted Title',
            content: 'Readers chose A',
            optionA: { label: 'A2', description: 'desc A2' },
            optionB: { label: 'B2', description: 'desc B2' },
        });
        mockedAi.generateStoryImage.mockResolvedValue('http://image.jpg');

        await handleGameLoopTick(now + 2000, mockBroadcast);

        expect(state.scifi.currentPhase).toBe('reading');
        expect(state.scifi.turnsToNextChoice).toBeGreaterThanOrEqual(2);
        expect(state.scifi.turnsToNextChoice).toBeLessThanOrEqual(4);
        expect(mockedStorage.getVotesForBlock).toHaveBeenCalledWith(1);
    });

    it('broadcasts time updates when phase has not ended', async () => {
        state.scifi.phaseEndsAt = now + 10000;

        await handleGameLoopTick(now + 5000, mockBroadcast);

        expect(mockBroadcast).toHaveBeenCalledWith('scifi', expect.objectContaining({
            type: 'SYNC_STATE',
            payload: expect.objectContaining({
                timeRemaining: 5000
            })
        }));
    });

    it('uses fallback when pregeneration is missing during narrative turn', async () => {
        state.scifi.phaseEndsAt = now + 1000;
        state.scifi.nextBlockA = undefined; // No pregenerated block
        mockedAi.generateStoryBlock.mockResolvedValue({
            title: 'Fallback Narrative',
            content: 'Pregen failed...',
            optionA: { label: 'A', description: 'desc A' },
            optionB: { label: 'B', description: 'desc B' },
        });
        mockedAi.generateStoryImage.mockResolvedValue('/images/fallback.jpg');

        await handleGameLoopTick(now + 2000, mockBroadcast);

        expect(mockedAi.generateStoryBlock).toHaveBeenCalled();
        expect(state.scifi.currentBlock?.title).toBe('Fallback Narrative');
    });

    it('handles image generation failure in game loop by using fallback', async () => {
        state.scifi.phaseEndsAt = now + 1000;
        state.scifi.nextBlockA = undefined;
        mockedAi.generateStoryBlock.mockResolvedValue({
            title: 'No Image',
            content: 'Text only...',
            optionA: { label: 'A', description: 'desc A' },
            optionB: { label: 'B', description: 'desc B' },
        });
        mockedAi.generateStoryImage.mockRejectedValue(new Error('API Down'));
        mockedStorage.getRandomImage.mockResolvedValue(null);

        await handleGameLoopTick(now + 2000, mockBroadcast);

        expect(state.scifi.currentBlock?.imageUrl).toBe('/images/img_1771936309521_ieycq2.jpg');
    });

    // --- New tests for timer separation ---

    it('includes timeToNextDecision in SYNC_STATE broadcast during reading phase', async () => {
        state.scifi.phaseEndsAt = now + 10000;
        state.scifi.decisionEndsAt = now + 10000 + 2 * NARRATIVE_TURN_MS;

        await handleGameLoopTick(now + 5000, mockBroadcast);

        expect(mockBroadcast).toHaveBeenCalledWith('scifi', expect.objectContaining({
            type: 'SYNC_STATE',
            payload: expect.objectContaining({
                timeRemaining: 5000,
                timeToNextDecision: 5000 + 2 * NARRATIVE_TURN_MS,
                initialTimeToNextDecision: 2 * NARRATIVE_TURN_MS + 1000,
            })
        }));
    });

    it('timeToNextDecision equals timeRemaining when in voting phase', async () => {
        state.scifi.currentPhase = 'voting';
        state.scifi.phaseEndsAt = now + 10000;
        state.scifi.decisionEndsAt = now + 10000;

        await handleGameLoopTick(now + 5000, mockBroadcast);

        const call = mockBroadcast.mock.calls[ 0 ];
        const payload = call[ 1 ].payload;
        expect(payload.timeRemaining).toBe(5000);
        expect(payload.timeToNextDecision).toBe(5000);
    });

    it('recalculates decisionEndsAt after narrative turn', async () => {
        state.scifi.turnsToNextChoice = 2;
        state.scifi.phaseEndsAt = now + 1000;
        mockedAi.generateStoryBlock.mockResolvedValue({
            title: 'Narrative',
            content: 'Content',
            optionA: { label: 'A', description: 'desc A' },
            optionB: { label: 'B', description: 'desc B' },
        });
        mockedAi.generateStoryImage.mockResolvedValue('http://image.jpg');

        const tickTime = now + 2000;
        await handleGameLoopTick(tickTime, mockBroadcast);

        // After decrement, turnsToNextChoice = 1
        // phaseEndsAt = tickTime + NARRATIVE_TURN_MS
        // decisionEndsAt = phaseEndsAt + 1 * NARRATIVE_TURN_MS
        const expectedPhaseEnd = tickTime + NARRATIVE_TURN_MS;
        const expectedDecisionEnd = expectedPhaseEnd + 1 * NARRATIVE_TURN_MS;
        expect(state.scifi.decisionEndsAt).toBe(expectedDecisionEnd);
        // Verify initialTimeToDecision is NOT updated after turn (remains what it was at start of reading)
        expect(state.scifi.initialTimeToDecision).toBe(2 * NARRATIVE_TURN_MS + 1000);
    });

    it('sets decisionEndsAt to phaseEndsAt on entering voting', async () => {
        state.scifi.turnsToNextChoice = 0;
        state.scifi.phaseEndsAt = now + 1000;

        const tickTime = now + 2000;
        await handleGameLoopTick(tickTime, mockBroadcast);

        // Entered voting: decisionEndsAt = phaseEndsAt
        expect(state.scifi.currentPhase).toBe('voting');
        expect(state.scifi.decisionEndsAt).toBe(state.scifi.phaseEndsAt);
    });

    it('recalculates decisionEndsAt after voting ends', async () => {
        state.scifi.currentPhase = 'voting';
        state.scifi.phaseEndsAt = now + 1000;
        mockedStorage.getVotesForBlock.mockResolvedValue([
            { choice: 'A', userId: '1' },
        ] as any);
        mockedAi.generateStoryBlock.mockResolvedValue({
            title: 'Post Vote',
            content: 'Voted content',
            optionA: { label: 'A', description: 'desc A' },
            optionB: { label: 'B', description: 'desc B' },
        });
        mockedAi.generateStoryImage.mockResolvedValue('http://image.jpg');

        const tickTime = now + 2000;
        await handleGameLoopTick(tickTime, mockBroadcast);

        expect(state.scifi.currentPhase).toBe('reading');
        const expectedPhaseEnd = tickTime + POST_VOTE_READING_MS;
        const expectedDecisionEnd = expectedPhaseEnd + state.scifi.turnsToNextChoice * NARRATIVE_TURN_MS;
        expect(state.scifi.decisionEndsAt).toBe(expectedDecisionEnd);
    });

    it('uses correct timing constants for phase durations', async () => {
        // Verify narrative turn uses NARRATIVE_TURN_MS
        state.scifi.turnsToNextChoice = 1;
        state.scifi.phaseEndsAt = now + 1000;
        mockedAi.generateStoryBlock.mockResolvedValue({
            title: 'T',
            content: 'C',
            optionA: { label: 'A', description: 'dA' },
            optionB: { label: 'B', description: 'dB' },
        });
        mockedAi.generateStoryImage.mockResolvedValue('http://x.jpg');

        const tickTime = now + 2000;
        await handleGameLoopTick(tickTime, mockBroadcast);

        expect(state.scifi.phaseEndsAt).toBe(tickTime + NARRATIVE_TURN_MS);
    });

    it('enters resolution phase when session end is reached', async () => {
        state.scifi.activeSession!.scheduledEnd = new Date(now - 1000); // Ended
        mockedAi.generateStoryBlock.mockResolvedValue({
            title: 'The End',
            content: 'Cliffhanger ending...',
        } as any);

        await handleGameLoopTick(now, mockBroadcast);

        expect(state.scifi.currentPhase).toBe('resolution');
        expect(mockedAi.generateStoryBlock).toHaveBeenCalledWith('scifi', expect.any(String), true, 1);
        expect(mockBroadcast).toHaveBeenCalledWith('scifi', expect.objectContaining({
            type: 'SYNC_STATE',
            payload: expect.objectContaining({
                phase: 'resolution'
            })
        }));
    });

    it('completes session after resolution phase duration ends', async () => {
        state.scifi.currentPhase = 'resolution';
        state.scifi.phaseEndsAt = now - 1000; // Resolution ended
        state.scifi.activeSession!.scheduledEnd = new Date(now - 5000);

        await handleGameLoopTick(now, mockBroadcast);

        expect(state.scifi.activeSession).toBeUndefined();
        expect(mockedStorage.updateSessionStatus).toHaveBeenCalledWith(1, 'completed');
        expect(mockBroadcast).toHaveBeenCalledWith('scifi', expect.objectContaining({
            type: 'SESSION_STATUS',
            payload: { status: 'completed', session: expect.any(Object) }
        }));
    });
});

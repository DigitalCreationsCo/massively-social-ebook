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
    },
}));

vi.mock('./ai', () => ({
    generateStoryBlock: vi.fn(),
    generateStoryImage: vi.fn(),
}));

const mockedStorage = vi.mocked(storage);
const mockedAi = vi.mocked(ai);

describe('handleGameLoopTick', () => {
    const mockBroadcast = vi.fn();
    const now = Date.now();

    beforeEach(() => {
        vi.clearAllMocks();
        // Setup initial state for a channel
        state.scifi = {
            currentPhase: 'reading',
            phaseEndsAt: now + 1000,
            currentBlock: { id: 1, content: 'Test content', title: 'Test', channelId: 'scifi', createdAt: new Date() } as any,
            turnsToNextChoice: 2,
        };
        // Default mock for createBlock to avoid undefined currentBlock
        mockedStorage.createBlock.mockImplementation(async (data: any) => ({ ...data, id: Math.random() }));
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
        expect(state.scifi.turnsToNextChoice).toBeGreaterThanOrEqual(3);
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
});

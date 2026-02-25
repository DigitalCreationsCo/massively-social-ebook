import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startRecurringScheduler } from './scheduler';
import { storage } from './storage';
import cron from 'node-cron';

vi.mock('./storage', () => ({
    storage: {
        listSessions: vi.fn(),
        createSession: vi.fn(),
    },
}));

vi.mock('node-cron', () => ({
    default: {
        schedule: vi.fn(),
    },
}));

const mockedStorage = vi.mocked(storage);
const mockedCron = vi.mocked(cron);

describe('SessionScheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('schedules a cron job on initialization', () => {
        mockedStorage.listSessions.mockResolvedValue([]);
        startRecurringScheduler();
        expect(mockedCron.schedule).toHaveBeenCalledWith('1 0 * * *', expect.any(Function));
    });

    it('seeds sessions if none exist for today', async () => {
        mockedStorage.listSessions.mockResolvedValue([]);
        mockedStorage.createSession.mockResolvedValue({} as any);

        // We need to trigger the seeding logic. Since it's called in startRecurringScheduler,
        // we can just call startRecurringScheduler and wait for the promise.
        // But the internal function isn't exported. We'll rely on the startup call.
        
        startRecurringScheduler();
        
        // Wait a bit for the async call
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockedStorage.createSession).toHaveBeenCalledTimes(2); // scifi and mystery
        expect(mockedStorage.createSession).toHaveBeenCalledWith(expect.objectContaining({
            channelId: 'scifi',
            title: expect.stringContaining('Galactic Horizon'),
        }));
    });

    it('skips seeding if sessions already exist for today', async () => {
        const today = new Date();
        mockedStorage.listSessions.mockResolvedValue([
            { scheduledStart: today, channelId: 'scifi', status: 'scheduled' } as any,
            { scheduledStart: today, channelId: 'mystery', status: 'scheduled' } as any
        ]);

        startRecurringScheduler();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockedStorage.createSession).not.toHaveBeenCalled();
    });
});

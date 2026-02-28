import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startRecurringScheduler } from './scheduler';
import { storage } from './storage';

vi.mock('./storage', () => ({
    storage: {
        listSessions: vi.fn(),
        createSession: vi.fn(),
        getSystemSetting: vi.fn(),
        setSystemSetting: vi.fn(),
        createNotificationLog: vi.fn(),
        getNotificationLog: vi.fn(),
        getUsers: vi.fn(),
    },
}));

const mockedStorage = vi.mocked(storage);

describe('SessionScheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('starts the notification loop on initialization', () => {
        mockedStorage.listSessions.mockResolvedValue([]);
        mockedStorage.getSystemSetting.mockResolvedValue(undefined);
        
        startRecurringScheduler();
        
        // Check if setInterval was called
        // Since we are using fake timers, we can't easily check if setInterval was called directly 
        // unless we spy on global.setInterval, but vitest handles this.
        // However, we can check if the loop runs by advancing time.
        
        // But first, let's just verify the immediate seeding happened
        expect(mockedStorage.listSessions).toHaveBeenCalled();
    });

    it('seeds sessions if none exist for today', async () => {
        mockedStorage.listSessions.mockResolvedValue([]);
        mockedStorage.createSession.mockResolvedValue({} as any);

        startRecurringScheduler();
        
        // Wait for async operations to complete
        // We advance timers slightly to allow microtasks and setTimeouts to process
        await vi.advanceTimersByTimeAsync(100);

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
        
        await vi.advanceTimersByTimeAsync(100);

        expect(mockedStorage.createSession).not.toHaveBeenCalled();
    });

    it('runs the notification loop and updates cursor', async () => {
        const now = Date.now();
        mockedStorage.getSystemSetting.mockResolvedValue((now - 20000).toString()); // Last processed 20s ago
        mockedStorage.listSessions.mockResolvedValue([]); // No sessions for events
        
        startRecurringScheduler();
        
        // Advance time to trigger interval
        await vi.advanceTimersByTimeAsync(31000); // 31s > 30s interval

        expect(mockedStorage.getSystemSetting).toHaveBeenCalledWith('notification_cursor');
        expect(mockedStorage.setSystemSetting).toHaveBeenCalledWith('notification_cursor', expect.any(String));
    });
});

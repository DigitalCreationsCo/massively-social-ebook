import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startRecurringScheduler } from './scheduler';
import { storage } from '../storage';

vi.mock('../storage', () => ({
    storage: {
        listSessions: vi.fn(),
        createSession: vi.fn(),
        getSystemSetting: vi.fn(),
        setSystemSetting: vi.fn(),
        createNotificationLog: vi.fn(),
        getNotificationLog: vi.fn(),
        getUsers: vi.fn(),
        getDueSchedules: vi.fn(),
        listSchedules: vi.fn(),
        getSessionsBySchedule: vi.fn(),
        getSchedulesByChannel: vi.fn(),
        createSchedule: vi.fn(),
        updateScheduleNextRunAt: vi.fn(),
        incrementScheduleSessionCount: vi.fn(),
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

    it('seeds two sessions (next + following) if none exist', async () => {
        mockedStorage.listSessions.mockResolvedValue([]);
        mockedStorage.createSession.mockResolvedValue({} as any);

        startRecurringScheduler();

        // Wait for async operations to complete
        await vi.advanceTimersByTimeAsync(100);

        // 2 channels * 2 days = 4 sessions created
        expect(mockedStorage.createSession).toHaveBeenCalledTimes(4);

        // Verify Scifi sessions
        expect(mockedStorage.createSession).toHaveBeenCalledWith(expect.objectContaining({
            channelId: 'scifi',
            title: expect.stringContaining('Galactic Horizon'),
        }));

        // Verify Mystery sessions
        expect(mockedStorage.createSession).toHaveBeenCalledWith(expect.objectContaining({
            channelId: 'mystery',
            title: expect.stringContaining('Midnight Alibi'),
        }));
    });

    it('seeds the second session if only the first exists', async () => {
        // Assume "Next" is today. We fake that today's session exists.
        const now = new Date();
        const todayString = now.toISOString().split('T')[ 0 ]; // Simple approx, or rely on loose matching

        // We'll just return a session that matches "today"
        // The implementation checks getMSTDateString(s.scheduledStart) === targetDateStr
        // We need to ensure our mock return value satisfies this.

        // Since we can't easily know the exact MST string without the helper,
        // we will mock listSessions to return a session that *would* match the first loop iteration
        // but not the second.

        // Actually, the implementation calls listSessions once per channel.
        // We can make listSessions return a list containing one session.

        // We need to craft a session date that matches the "Next" target.
        // For scifi, hour is 19.
        const nextScifi = new Date(now);
        nextScifi.setHours(19, 0, 0, 0);

        // If we are testing early in the day, "Next" is today.
        // If test runs after 19:00, "Next" is tomorrow.
        // vitest fake timers start at 0 (epoch) by default if not specified? 
        // Actually best to set system time to a known fixed point.
        vi.setSystemTime(new Date('2024-01-01T12:00:00Z')); // Noon UTC

        // MST is UTC-7. So 12:00 UTC is 05:00 MST.
        // So "Next" is Today (Jan 1) at 19:00 MST.
        // "Following" is Tomorrow (Jan 2) at 19:00 MST.

        const jan1 = new Date('2024-01-01T19:00:00-07:00'); // Scifi Jan 1
        const jan2 = new Date('2024-01-02T19:00:00-07:00'); // Scifi Jan 2

        mockedStorage.listSessions.mockImplementation(async (channelId) => {
            if (channelId === 'scifi') {
                return [ { scheduledStart: jan1, channelId: 'scifi', status: 'scheduled' } as any ];
            }
            return [];
        });

        startRecurringScheduler();
        await vi.advanceTimersByTimeAsync(100);

        // Scifi: Jan 1 exists, Jan 2 missing -> Create Jan 2 (1 call)
        // Mystery: Both missing -> Create Jan 1 & Jan 2 (2 calls)
        // Total 3 calls
        expect(mockedStorage.createSession).toHaveBeenCalledTimes(3);
    });

    it('skips seeding if both sessions exist', async () => {
        vi.setSystemTime(new Date('2024-01-01T12:00:00Z')); // 05:00 MST

        const jan1Scifi = new Date('2024-01-01T19:00:00-07:00');
        const jan2Scifi = new Date('2024-01-02T19:00:00-07:00');

        const jan1Mystery = new Date('2024-01-01T20:00:00-07:00');
        const jan2Mystery = new Date('2024-01-02T20:00:00-07:00');

        mockedStorage.listSessions.mockResolvedValue([
            { scheduledStart: jan1Scifi, channelId: 'scifi', status: 'scheduled' } as any,
            { scheduledStart: jan2Scifi, channelId: 'scifi', status: 'scheduled' } as any,
            { scheduledStart: jan1Mystery, channelId: 'mystery', status: 'scheduled' } as any,
            { scheduledStart: jan2Mystery, channelId: 'mystery', status: 'scheduled' } as any
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

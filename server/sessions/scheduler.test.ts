import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { storage } from '../storage';

vi.mock('./scheduler', () => {
    return {
        ensureSessionsExistWithinLookahead: vi.fn(),
        checkAndSendPushWarnings: vi.fn(),
        checkAndSendWeeklyBriefing: vi.fn(),
        startRecurringScheduler: vi.fn(),
    };
});

// 2. Grab the mocked versions for expectations
import * as scheduler from './scheduler';
const mockedCheckWarnings = vi.mocked(scheduler.checkAndSendPushWarnings);
const mockedSeeding = vi.mocked(scheduler.ensureSessionsExistWithinLookahead);

vi.mock('../storage', () => ({
    storage: {
        getChannels: vi.fn(),
        listSessions: vi.fn(),
        getSessionsInWindow: vi.fn(), // Added new mock
        createSessionWithScheduleUpdate: vi.fn(), // Updated to the correct method
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
        getChannel: vi.fn(),
        getGlobalSessionsInWindow: vi.fn(),
        shouldSendWeeklyBriefing: vi.fn(),
        markWeeklyBriefingSent: vi.fn(),
    },
}));

const mockedStorage = vi.mocked(storage);

describe('Idempotent Scheduler Engine', () => {
    const now = new Date('2026-03-30T12:00:00Z');

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(now);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('Notification Logic (notification_cursor)', () => {
        it('uses cursor to define search window and updates after execution', async () => {
            // Setup: Last run was 2 minutes ago
            const cursorTime = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
            mockedStorage.getSystemSetting.mockResolvedValue(cursorTime);
            mockedStorage.getGlobalSessionsInWindow.mockResolvedValue([]);

            await scheduler.checkAndSendPushWarnings();

            const expectedLookahead = new Date(now.getTime() + 5 * 60 * 1000);

            // Verify window bounds
            expect(mockedStorage.getGlobalSessionsInWindow).toHaveBeenCalledWith(
                new Date(cursorTime),
                expectedLookahead,
                'scheduled'
            );

            // Verify cursor advanced
            expect(mockedStorage.setSystemSetting).toHaveBeenCalledWith(
                'notification_cursor',
                expectedLookahead.toISOString()
            );
        });

        it('prevents duplicate notifications via window isolation', async () => {
            mockedStorage.getSystemSetting.mockResolvedValue(now.toISOString());
            mockedStorage.getGlobalSessionsInWindow.mockResolvedValue([]);

            await scheduler.checkAndSendPushWarnings();

            // Should start exactly where the last one ended
            expect(mockedStorage.getGlobalSessionsInWindow).toHaveBeenCalledWith(
                now,
                expect.any(Date),
                'scheduled'
            );
        });
    });

    describe('Seeding Logic (seeding_cursor)', () => {
        it('skips schedule generation if seeding interval has not elapsed', async () => {
            const recentRun = new Date(now.getTime() - 5 * 60 * 1000).toISOString(); // 5m ago
            mockedStorage.getSystemSetting.mockResolvedValue(recentRun);

            await scheduler.ensureSessionsExistWithinLookahead();

            expect(mockedStorage.listSchedules).not.toHaveBeenCalled();
        });

        it('executes and updates cursor when interval expires', async () => {
            mockedStorage.getSystemSetting.mockResolvedValue(undefined); // Fresh start
            mockedStorage.listSchedules.mockResolvedValue([]);

            await scheduler.ensureSessionsExistWithinLookahead();

            expect(mockedStorage.setSystemSetting).toHaveBeenCalledWith(
                'seeding_cursor',
                now.toISOString()
            );
        });
    });

    describe('Weekly Briefing Idempotency', () => {
        it('sends exactly once per ISO week', async () => {
            const weekKey = "2026-14";
            mockedStorage.getSystemSetting.mockResolvedValueOnce(undefined); // Not sent yet
            mockedStorage.getUsers.mockResolvedValue({ users: [ { email: 'test@example.com' } ] } as any);

            await scheduler.checkAndSendWeeklyBriefing();

            expect(mockedStorage.setSystemSetting).toHaveBeenCalledWith('last_weekly_briefing_week', weekKey);
            expect(mockedStorage.getUsers).toHaveBeenCalledTimes(1);

            // Immediate second attempt
            mockedStorage.getSystemSetting.mockResolvedValue(weekKey);
            await scheduler.checkAndSendWeeklyBriefing();

            // Should not fetch users or send again
            expect(mockedStorage.getUsers).toHaveBeenCalledTimes(1);
        });
    });
});

describe('Stateless Window Scheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('blocks automated seeding when a manual session occupies the exact timeslot', async () => {
        vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));

        const objMockSchedule = {
            id: 1,
            channelId: 'scifi',
            scheduledDays: [ 'monday' ], // March 2, 2026 is a Monday
            scheduledTime: '19:00',
            intervalEnabled: true,
            sessionCount: 5,
        };

        const dateManualTimeslot = new Date('2026-03-02T19:00:00-07:00'); // MST alignment
        const arrMockSessionsBlocking = [
            { scheduledStart: dateManualTimeslot, channelId: 'scifi', status: 'scheduled', scheduleId: null } // Manual override
        ];

        mockedStorage.getSystemSetting.mockResolvedValue('0'); // Force lookahead run
        mockedStorage.listSchedules.mockResolvedValue([ objMockSchedule as any ]);
        mockedStorage.getSessionsInWindow.mockResolvedValue(arrMockSessionsBlocking as any);

        scheduler.startRecurringScheduler();
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000); // Advance by SEEDING_INTERVAL_MS

        // createSessionWithScheduleUpdate should NOT be called due to timeslot match
        expect(mockedStorage.createSessionWithScheduleUpdate).not.toHaveBeenCalled();
    });

    it('successfully generates automated sessions when gaps are detected via precise timestamping', async () => {
        vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));

        const objMockSchedule = {
            id: 1,
            channelId: 'scifi',
            scheduledDays: [ 'monday' ], // March 2, 2026
            scheduledTime: '19:00',
            intervalEnabled: true,
            sessionCount: 5,
        };

        // This existing session is at 18:00 MST, so 19:00 MST remains a gap
        const dateOffsetTimeslot = new Date('2026-03-02T18:00:00-07:00');
        const arrMockSessionsNonBlocking = [
            { scheduledStart: dateOffsetTimeslot, channelId: 'scifi', status: 'scheduled', scheduleId: 1 }
        ];

        mockedStorage.getSystemSetting.mockResolvedValue('0');
        mockedStorage.listSchedules.mockResolvedValue([ objMockSchedule as any ]);
        mockedStorage.getSessionsInWindow.mockResolvedValue(arrMockSessionsNonBlocking as any);
        mockedStorage.getChannel.mockResolvedValue({ id: 1, channelId: 'scifi', description: 'desc' } as any);

        scheduler.startRecurringScheduler();
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

        // Gap detected at exactly 19:00 MST, automated seeding proceeds
        expect(mockedStorage.createSessionWithScheduleUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                scheduledStart: new Date('2026-03-02T19:00:00-07:00'),
                scheduleId: 1
            }),
            1
        );
    });

    it('advances the cursor strictly after successful runs', async () => {
        vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));

        const numNow = Date.now();
        mockedStorage.getSystemSetting.mockResolvedValue((numNow - 20000).toString());
        mockedStorage.listSchedules.mockResolvedValue([]);
        mockedStorage.getChannels.mockResolvedValue([]);
        mockedStorage.getDueSchedules.mockResolvedValue([]);
        mockedStorage.getSessionsInWindow.mockResolvedValue([]);

        scheduler.startRecurringScheduler();

        await vi.advanceTimersByTimeAsync(31000);

        expect(mockedStorage.getSystemSetting).toHaveBeenCalledWith('notification_cursor');
        expect(mockedStorage.setSystemSetting).toHaveBeenCalledWith('notification_cursor', expect.any(String));
    });

    it('seeding_cursor: skips generation if interval has not elapsed', async () => {
        const recentRun = new Date(Date.now() - 5000).toISOString(); // 5 seconds ago
        mockedStorage.getSystemSetting.mockResolvedValue(recentRun);

        await scheduler.ensureSessionsExistWithinLookahead();

        // Verification: Should exit early
        expect(mockedStorage.listSchedules).not.toHaveBeenCalled();
    });

    it('notification_cursor: processes missed windows after a lag', async () => {
        const now = new Date('2026-03-30T12:00:00Z');
        const lagPoint = new Date('2026-03-30T11:50:00Z').toISOString(); // 10 mins ago

        // 1. Mock the cursor to show we haven't run in 10 minutes
        mockedStorage.getSystemSetting.mockResolvedValue(lagPoint);

        // 2. Mock a session that started during that 10-minute gap
        const missedSession = { id: 99, title: 'The Lost Chapter', scheduledStart: new Date('2026-03-30T11:55:00Z') };
        mockedStorage.getGlobalSessionsInWindow.mockResolvedValue([ missedSession ]);

        await scheduler.checkAndSendPushWarnings();

        // Verification: It should have queried from the lagPoint, not just 'now'
        expect(mockedStorage.getGlobalSessionsInWindow).toHaveBeenCalledWith(
            new Date(lagPoint),
            expect.any(Date),
            'scheduled'
        );
    });

    it('sends the weekly briefing exactly once even if triggered multiple times in the same minute', async () => {
        // Set time to Monday at 3:00:00 PM
        const mondayThreePM = new Date('2026-03-30T15:00:00Z');
        vi.setSystemTime(mondayThreePM);
        const weekKey = "2026-14";

        // First call: Setting is empty, should send
        mockedStorage.getSystemSetting.mockResolvedValueOnce(undefined); // last_weekly_briefing_week
        mockedStorage.getUsers.mockResolvedValue({ users: [ { email: 'test@cinematic.com' } ] } as any);

        await scheduler.checkAndSendWeeklyBriefing();

        expect(mockedStorage.setSystemSetting).toHaveBeenCalledWith('last_weekly_briefing_week', weekKey);
        expect(mockedStorage.getUsers).toHaveBeenCalledTimes(1);

        // Second call: 30 seconds later, still 3:00 PM
        vi.advanceTimersByTime(30000);
        mockedStorage.getSystemSetting.mockResolvedValue(weekKey); // Now it's set

        await scheduler.checkAndSendWeeklyBriefing();

        // getUsers should NOT have been called again
        expect(mockedStorage.getUsers).toHaveBeenCalledTimes(1);
    });

    it('notification_cursor: resumes from last processed timestamp to prevent skipped notifications', async () => {
        const now = new Date('2026-03-30T12:00:00Z');
        vi.setSystemTime(now);

        // Scenario: Last check was 10 minutes ago (a lag occurred)
        const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
        mockedStorage.getSystemSetting.mockResolvedValueOnce(tenMinsAgo); // cursor value

        // We expect the lookahead to be now + 5 minutes
        const expectedLookahead = new Date(now.getTime() + 5 * 60 * 1000);

        await scheduler.checkAndSendPushWarnings();

        // 1. Verify it queried from the old cursor to the new lookahead
        expect(mockedStorage.getGlobalSessionsInWindow).toHaveBeenCalledWith(
            new Date(tenMinsAgo),
            expectedLookahead,
            'scheduled'
        );

        // 2. Verify the cursor was advanced to the new lookahead
        expect(mockedStorage.setSystemSetting).toHaveBeenCalledWith(
            'notification_cursor',
            expectedLookahead.toISOString()
        );
    });

    it('seeding_cursor: prevents redundant seeding runs within the same interval', async () => {
        const now = new Date('2026-03-30T12:00:00Z');
        vi.setSystemTime(now);

        // Scenario: Seeding just ran 1 minute ago
        const oneMinAgo = new Date(now.getTime() - 1 * 60 * 1000).toISOString();
        mockedStorage.getSystemSetting.mockResolvedValue(oneMinAgo);

        // Trigger the seeding check logic (usually inside startRecurringScheduler or a dedicated function)
        await scheduler.ensureSessionsExistWithinLookahead();

        // Requirement: Should see the cursor check, but NO schedule fetching or session creation
        expect(mockedStorage.getSystemSetting).toHaveBeenCalledWith('seeding_cursor');
        expect(mockedStorage.listSchedules).not.toHaveBeenCalled();
    });

    it('seeding_cursor: updates after a successful seeding run', async () => {
        const now = new Date('2026-03-30T12:00:00Z');
        vi.setSystemTime(now);

        // Scenario: No cursor exists (first run) or it's expired
        mockedStorage.getSystemSetting.mockResolvedValue(undefined);
        mockedStorage.listSchedules.mockResolvedValue([]);

        await scheduler.ensureSessionsExistWithinLookahead();

        // Requirement: Cursor must be set to the current time to "lock" the interval
        expect(mockedStorage.setSystemSetting).toHaveBeenCalledWith(
            'seeding_cursor',
            now.toISOString()
        );
    });

    it('checkAndSendPushWarnings: correctly uses cursor to define the search window', async () => {
        const now = new Date('2026-03-30T12:00:00Z');
        vi.setSystemTime(now);

        // Mock a cursor that is 2 minutes old
        const cursorTime = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
        mockedStorage.getSystemSetting.mockResolvedValue(cursorTime);
        mockedStorage.getGlobalSessionsInWindow.mockResolvedValue([]);

        // We call the actual implementation (not the mock) here for unit testing
        // Note: To do this, you might need to export the unmocked function 
        // or test it in a separate file where it isn't mocked.
        await scheduler.checkAndSendPushWarnings();

        const expectedLookahead = new Date(now.getTime() + 5 * 60 * 1000);

        expect(mockedStorage.getGlobalSessionsInWindow).toHaveBeenCalledWith(
            new Date(cursorTime),
            expectedLookahead,
            'scheduled'
        );
    });
});

describe('Scheduler Orchestration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    it('dispatches notification checks every 30 seconds', async () => {
        // Start the loop
        scheduler.startRecurringScheduler();

        // Fast-forward 31 seconds
        await vi.advanceTimersByTimeAsync(31000);

        // Verification: The warning check should have fired once
        expect(mockedCheckWarnings).toHaveBeenCalledTimes(1);
    });

    it('dispatches seeding lookahead only every 30 minutes', async () => {
        scheduler.startRecurringScheduler();

        // Fast-forward 29 minutes (seeding should NOT have fired again yet)
        await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
        // It fires once on init, so we check for that first call
        expect(mockedSeeding).toHaveBeenCalledTimes(1);

        // Fast-forward to the 31st minute
        await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

        // Verification: Now it should have fired a second time
        expect(mockedSeeding).toHaveBeenCalledTimes(2);
    });
});
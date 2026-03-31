import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as scheduler from './scheduler';
import { storage } from '../storage';

// 1. Target external dependencies, never the System Under Test (SUT)
vi.mock('../storage', () => ({
    storage: {
        getChannels: vi.fn(),
        listSessions: vi.fn(),
        getSessionsInWindow: vi.fn(),
        createSessionWithScheduleUpdate: vi.fn(),
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

vi.mock('../logger', () => ({
    logger: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
    }
}));

const mockStorage = vi.mocked(storage);

describe('Idempotent Scheduler Engine', () => {
    const dateNowMock = new Date('2026-03-30T12:00:00Z');

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(dateNowMock);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('Notification Logic (notification_cursor)', () => {
        it('uses cursor to define search window and updates after execution', async () => {
            const timeCursor = new Date(dateNowMock.getTime() - 2 * 60 * 1000).toISOString();
            mockStorage.getSystemSetting.mockResolvedValue(timeCursor);
            mockStorage.getGlobalSessionsInWindow.mockResolvedValue([]);

            await scheduler.checkAndSendPushWarnings();

            const dateLookaheadExpected = new Date(dateNowMock.getTime() + 5 * 60 * 1000);

            expect(mockStorage.getGlobalSessionsInWindow).toHaveBeenCalledWith(
                new Date(timeCursor),
                dateLookaheadExpected,
                'scheduled'
            );

            expect(mockStorage.setSystemSetting).toHaveBeenCalledWith(
                'notification_cursor',
                dateLookaheadExpected.toISOString()
            );
        });

        it('resumes from last processed timestamp to prevent skipped notifications', async () => {
            const timeTenMinsAgo = new Date(dateNowMock.getTime() - 10 * 60 * 1000).toISOString();
            mockStorage.getSystemSetting.mockResolvedValueOnce(timeTenMinsAgo);

            const dateLookaheadExpected = new Date(dateNowMock.getTime() + 5 * 60 * 1000);

            await scheduler.checkAndSendPushWarnings();

            expect(mockStorage.getGlobalSessionsInWindow).toHaveBeenCalledWith(
                new Date(timeTenMinsAgo),
                dateLookaheadExpected,
                'scheduled'
            );
            expect(mockStorage.setSystemSetting).toHaveBeenCalledWith(
                'notification_cursor',
                dateLookaheadExpected.toISOString()
            );
        });
    });

    describe('Seeding Logic (Strict Timestamp Binding)', () => {
        it('blocks automated seeding when a manual session occupies the exact timeslot', async () => {
            const dateManualTimeslot = new Date('2026-03-30T19:00:00-07:00'); // MST Alignment
            const arrSessionsBlockingMock = [
                { scheduledStart: dateManualTimeslot, channelId: 'scifi', status: 'scheduled', scheduleId: null }
            ];

            const objScheduleMock = {
                id: 1,
                channelId: 'scifi',
                scheduledDays: [ 'monday' ], // Mar 30 is Monday
                scheduledTime: '19:00',
                intervalEnabled: true,
                sessionCount: 5,
                timezone: 'America/Denver'
            };

            mockStorage.listSchedules.mockResolvedValue([ objScheduleMock as any ]);
            mockStorage.getSessionsInWindow.mockResolvedValue(arrSessionsBlockingMock as any);

            await scheduler.ensureSessionsExistWithinLookahead();

            expect(mockStorage.createSessionWithScheduleUpdate).not.toHaveBeenCalled();
        });

        it('generates automated sessions when exact timestamp gaps are detected', async () => {
            const dateOffsetTimeslot = new Date('2026-03-30T18:00:00-07:00'); // 18:00, leaving 19:00 open
            const arrSessionsNonBlockingMock = [
                { scheduledStart: dateOffsetTimeslot, channelId: 'scifi', status: 'scheduled', scheduleId: 1 }
            ];

            const objScheduleMock = {
                id: 1,
                channelId: 'scifi',
                scheduledDays: [ 'monday' ],
                scheduledTime: '19:00',
                intervalEnabled: true,
                sessionCount: 5,
                timezone: 'America/Denver',
                titleConfig: { programName: 'SciFi Daily' }
            };

            mockStorage.listSchedules.mockResolvedValue([ objScheduleMock as any ]);
            mockStorage.getSessionsInWindow.mockResolvedValue(arrSessionsNonBlockingMock as any);
            mockStorage.getChannel.mockResolvedValue({ id: 1, channelId: 'scifi', description: 'desc' } as any);

            await scheduler.ensureSessionsExistWithinLookahead();

            expect(mockStorage.createSessionWithScheduleUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    scheduledStart: new Date('2026-03-31T02:00:00.000Z'), // UTC equivalent of 19:00 MST
                    scheduleId: 1
                }),
                1
            );
        });
    });

    describe('Weekly Briefing Idempotency', () => {
        it('sends exactly once per ISO week', async () => {
            const stringWeekKey = "2026-14";
            mockStorage.getSystemSetting.mockResolvedValueOnce(undefined);
            mockStorage.getUsers.mockResolvedValue({ users: [ { email: 'test@example.com' } ] } as any);
            mockStorage.shouldSendWeeklyBriefing.mockResolvedValue(true);

            // Time is Monday 15:00:00
            vi.setSystemTime(new Date('2026-03-30T15:00:00Z'));

            await scheduler.checkAndSendWeeklyBriefing();

            expect(mockStorage.markWeeklyBriefingSent).toHaveBeenCalledWith(stringWeekKey);

            // Immediate second attempt simulates race condition
            mockStorage.shouldSendWeeklyBriefing.mockResolvedValue(false);
            await scheduler.checkAndSendWeeklyBriefing();

            // Verification: Email trigger should not fire again
            expect(mockStorage.markWeeklyBriefingSent).toHaveBeenCalledTimes(1);
        });
    });
});
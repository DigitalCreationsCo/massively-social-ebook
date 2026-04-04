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
    const dateNowMock = new Date(2026, 2, 30, 12, 0, 0);

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
            const dateManualTimeslot = new Date('2026-03-30T19:00:00-06:00'); // MDT Alignment
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

            // It should NOT spawn a session for Mar 30 (which is Mar 31 01:00 UTC) 
            expect(mockStorage.createSessionWithScheduleUpdate).not.toHaveBeenCalledWith(
                expect.objectContaining({
                    scheduledStart: new Date('2026-03-31T01:00:00.000Z')
                }),
                expect.anything()
            );
        });

        it('generates automated sessions when exact timestamp gaps are detected', async () => {
            const dateOffsetTimeslot = new Date('2026-03-30T18:00:00-06:00'); // 18:00 MDT
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

            // It SHOULD spawn a session for Mar 30 19:00 MDT (Mar 31 01:00 UTC)
            expect(mockStorage.createSessionWithScheduleUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    scheduledStart: new Date('2026-03-31T01:00:00.000Z'),
                    scheduleId: 1
                }),
                1
            );
        });
        it('does NOT duplicate a session if a cancelled session exists for that exact time', async () => {
            const dateOffsetTimeslot = new Date('2026-03-31T01:00:00.000Z'); // 19:00 MDT
            const arrSessionsNonBlockingMock = [
                { scheduledStart: dateOffsetTimeslot, channelId: 'scifi', status: 'cancelled', scheduleId: 1 }
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
            // Now getSessionsInWindow fetches all statuses because we passed undefined in the impl
            mockStorage.getSessionsInWindow.mockResolvedValue(arrSessionsNonBlockingMock as any);
            mockStorage.getChannel.mockResolvedValue({ id: 1, channelId: 'scifi', description: 'desc' } as any);

            await scheduler.ensureSessionsExistWithinLookahead();

            // Should NOT spawn because the cancelled session fills the slot
            expect(mockStorage.createSessionWithScheduleUpdate).not.toHaveBeenCalledWith(
                expect.objectContaining({
                    scheduledStart: new Date('2026-03-31T01:00:00.000Z')
                }),
                expect.anything()
            );
        });

        it('does NOT spawn sessions in the past', async () => {
            const objScheduleMock = {
                id: 1,
                channelId: 'scifi',
                scheduledDays: [ 'monday' ],
                scheduledTime: '09:00', // 09:00 MDT = 15:00 UTC. Past relative to 16:00 UTC.
                intervalEnabled: true,
                sessionCount: 5,
                timezone: 'America/Denver',
                titleConfig: { programName: 'SciFi Daily' }
            };

            mockStorage.listSchedules.mockResolvedValue([ objScheduleMock as any ]);
            mockStorage.getSessionsInWindow.mockResolvedValue([] as any); // Empty! Slot seems open!
            mockStorage.getChannel.mockResolvedValue({ id: 1, channelId: 'scifi', description: 'desc' } as any);

            await scheduler.ensureSessionsExistWithinLookahead();

            // Should NOT spawn the Monday 09:00 MDT (15:00 UTC) because it's in the past
            expect(mockStorage.createSessionWithScheduleUpdate).not.toHaveBeenCalledWith(
                expect.objectContaining({
                    scheduledStart: new Date('2026-03-30T15:00:00.000Z')
                }),
                expect.anything()
            );
        });
    });

    describe('Weekly Briefing Idempotency', () => {
        it('sends exactly once per ISO week', async () => {
            const stringWeekKey = "2026-14";
            mockStorage.getSystemSetting.mockResolvedValueOnce(undefined);
            mockStorage.getUsers.mockResolvedValue({ users: [ { email: 'test@example.com' } ] } as any);
            mockStorage.shouldSendWeeklyBriefing.mockResolvedValue(true);
            mockStorage.listSessions.mockResolvedValue([]);

            // Time is Monday 15:00:00 Local time 
            vi.setSystemTime(new Date(2026, 2, 30, 15, 0, 0));

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
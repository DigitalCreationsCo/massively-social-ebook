import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startRecurringScheduler } from './scheduler';
import { storage } from '../storage';

vi.mock('../storage', () => ({
    storage: {
        getChannels: vi.fn(),
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

    it('starts the notification loop on initialization', async () => {
        vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
        
        mockedStorage.getChannels.mockResolvedValue([
            { id: 1, channelId: 'scifi', name: 'Sci-Fi', description: null, createdAt: new Date() },
            { id: 2, channelId: 'mystery', name: 'Mystery', description: null, createdAt: new Date() },
        ]);
        
        mockedStorage.listSchedules.mockResolvedValue([]);
        mockedStorage.getSchedulesByChannel.mockResolvedValue([]);
        mockedStorage.createSchedule.mockResolvedValue({ id: 1 } as any);
        mockedStorage.updateScheduleNextRunAt.mockResolvedValue(undefined);

        startRecurringScheduler();

        await vi.advanceTimersByTimeAsync(100);

        expect(mockedStorage.getChannels).toHaveBeenCalled();
    });

    it('seeds default schedules if none exist', async () => {
        vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
        
        mockedStorage.getChannels.mockResolvedValue([
            { id: 1, channelId: 'scifi', name: 'Sci-Fi', description: null, createdAt: new Date() },
            { id: 2, channelId: 'mystery', name: 'Mystery', description: null, createdAt: new Date() },
        ]);
        
        mockedStorage.listSchedules.mockResolvedValue([]);
        mockedStorage.getSchedulesByChannel.mockResolvedValue([]);
        mockedStorage.createSchedule.mockResolvedValue({ id: 1 } as any);
        mockedStorage.updateScheduleNextRunAt.mockResolvedValue(undefined);

        startRecurringScheduler();
        await vi.advanceTimersByTimeAsync(100);

        expect(mockedStorage.createSchedule).toHaveBeenCalledTimes(2);
        expect(mockedStorage.createSchedule).toHaveBeenCalledWith(expect.objectContaining({
            channelId: 'scifi',
            intervalEnabled: true,
        }));
        expect(mockedStorage.createSchedule).toHaveBeenCalledWith(expect.objectContaining({
            channelId: 'mystery',
            intervalEnabled: true,
        }));
    });

    it('skips seeding for channels that already have schedules', async () => {
        vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
        
        mockedStorage.getChannels.mockResolvedValue([
            { id: 1, channelId: 'scifi', name: 'Sci-Fi', description: null, createdAt: new Date() },
        ]);
        
        const existingSchedule = {
            id: 1,
            channelId: 'scifi',
            scheduledDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
            scheduledTime: '19:00',
            intervalEnabled: true,
            sessionCount: 5,
        };
        
        mockedStorage.getSchedulesByChannel.mockResolvedValue([existingSchedule as any]);
        mockedStorage.listSchedules.mockResolvedValue([existingSchedule as any]);
        mockedStorage.getSessionsBySchedule.mockResolvedValue([]);

        startRecurringScheduler();
        await vi.advanceTimersByTimeAsync(100);

        expect(mockedStorage.createSchedule).not.toHaveBeenCalled();
    });

    it('skips seeding if sessions exist for all scheduled days', async () => {
        vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
        
        mockedStorage.getChannels.mockResolvedValue([
            { id: 1, channelId: 'scifi', name: 'Sci-Fi', description: null, createdAt: new Date() },
        ]);
        
        const mockSchedule = {
            id: 1,
            channelId: 'scifi',
            scheduledDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
            scheduledTime: '19:00',
            intervalEnabled: true,
            sessionCount: 7,
        };
        
        const sessions = Array.from({ length: 7 }, (_, i) => {
            const date = new Date('2024-01-01T19:00:00-07:00');
            date.setDate(date.getDate() + i);
            return { scheduledStart: date, channelId: 'scifi', status: 'scheduled' };
        });
        
        mockedStorage.listSchedules.mockResolvedValue([mockSchedule as any]);
        mockedStorage.getSessionsBySchedule.mockResolvedValue(sessions as any);

        startRecurringScheduler();
        await vi.advanceTimersByTimeAsync(100);

        expect(mockedStorage.createSession).not.toHaveBeenCalled();
    });

    it('runs the notification loop and updates cursor', async () => {
        vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
        
        const now = Date.now();
        mockedStorage.getSystemSetting.mockResolvedValue((now - 20000).toString());
        mockedStorage.listSchedules.mockResolvedValue([]);
        mockedStorage.getChannels.mockResolvedValue([]);
        mockedStorage.getDueSchedules.mockResolvedValue([]);
        mockedStorage.listSessions.mockResolvedValue([]);

        startRecurringScheduler();

        await vi.advanceTimersByTimeAsync(31000);

        expect(mockedStorage.getSystemSetting).toHaveBeenCalledWith('notification_cursor');
        expect(mockedStorage.setSystemSetting).toHaveBeenCalledWith('notification_cursor', expect.any(String));
    });
});

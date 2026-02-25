import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storage } from './storage';
import { sendEmail, sendPushNotification } from './notifications';
import { checkAndSendPushWarnings, dispatchWeeklyBriefing } from './scheduler';

vi.mock('./storage', () => ({
    storage: {
        getUsers: vi.fn(),
        listSessions: vi.fn(),
        createSession: vi.fn(),
    },
}));

vi.mock('./notifications', () => ({
    sendEmail: vi.fn(),
    sendPushNotification: vi.fn(),
}));

describe('Notification System', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    it('triggers push notifications 5 minutes before session start', async () => {
        const now = new Date('2026-02-25T10:00:00Z');
        vi.setSystemTime(now);

        const mockSession = {
            id: 1,
            title: 'Test Session',
            scheduledStart: new Date('2026-02-25T10:05:00Z'), // Exactly 5 mins away
            status: 'scheduled',
        };

        const mockUser = {
            id: 1,
            email: 'test@example.com',
            pushToken: 'token-123',
        };

        vi.mocked(storage.listSessions).mockResolvedValue([ mockSession ] as any);
        vi.mocked(storage.getUsers).mockResolvedValue([ mockUser ] as any);

        await checkAndSendPushWarnings();

        expect(sendPushNotification).toHaveBeenCalledWith(
            'token-123',
            '🔔 5 Minutes to Go-Time',
            "Today's chapter is about to begin. Claim your seat now for your daily 25."
        );
    });

    it('sends weekly emails on Sunday afternoon', async () => {
        const now = new Date('2026-03-01T15:00:00Z'); // Sunday
        vi.setSystemTime(now);

        const mockSession = {
            id: 1,
            title: 'Sunday Story',
            scheduledStart: new Date('2026-03-01T19:00:00Z'),
            status: 'scheduled',
        };

        const mockUser = {
            id: 1,
            email: 'test@example.com',
        };

        vi.mocked(storage.listSessions).mockResolvedValue([ mockSession ] as any);
        vi.mocked(storage.getUsers).mockResolvedValue([ mockUser ] as any);

        await dispatchWeeklyBriefing();

        expect(sendEmail).toHaveBeenCalledWith(
            'test@example.com',
            'Your Weekly 25th Chapter Schedule',
            expect.stringContaining('Sunday Story')
        );
    });
});

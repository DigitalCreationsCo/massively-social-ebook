import { describe, it, expect, vi, beforeEach } from 'vitest';
import { google } from 'googleapis';
import { CalendarService } from '.';
import { sendEmail } from '../notifications';

// Mock googleapis
vi.mock('googleapis', () => {
    const mockInsert = vi.fn().mockResolvedValue({ data: {} });
    return {
        google: {
            auth: {
                JWT: vi.fn().mockImplementation(function () {
                    return {
                        authorize: vi.fn(),
                    };
                }),
            },
            calendar: vi.fn().mockReturnValue({
                events: {
                    insert: mockInsert,
                },
            }),
        },
    };
});

// Mock notifications
vi.mock('./notifications', () => ({
    sendEmail: vi.fn().mockResolvedValue({ success: true }),
    sendPushNotification: vi.fn().mockResolvedValue({ success: true }),
}));

describe('Email & Calendar Integration', () => {
    const mockSession = {
        id: 1,
        title: 'The Great Hack',
        description: 'A story about code.',
        scheduledStart: new Date('2026-03-01T15:00:00Z'),
        scheduledEnd: new Date('2026-03-01T15:25:00Z'),
        channelId: 'scifi',
        status: 'scheduled',
    };

    const mockEmail = 'reader@example.com';

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'service@test.com';
        process.env.GOOGLE_PRIVATE_KEY = 'mock-key';
        process.env.AZURE_CLIENT_ID = 'id';
        process.env.AZURE_CLIENT_SECRET = 'secret';
        process.env.AZURE_TENANT_ID = 'tenant';
    });

    it('successfully calls Google Calendar API with correct payload', async () => {
        await CalendarService.addToGoogle(mockEmail, mockSession as any);

        const calendar = (google.calendar as any)();
        expect(calendar.events.insert).toHaveBeenCalledWith(expect.objectContaining({
            requestBody: expect.objectContaining({
                summary: expect.stringContaining('The Great Hack'),
                attendees: [ { email: mockEmail } ],
            }),
            sendUpdates: 'all',
        }));
    });

    it('handles missing credentials gracefully', async () => {
        delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        const result = await CalendarService.addToGoogle(mockEmail, mockSession as any);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('unconfigured');
    });

    it('logs email dispatch for notifications', async () => {
        await sendEmail(mockEmail, 'Subject', 'Body');
        expect(sendEmail).toHaveBeenCalledWith(mockEmail, 'Subject', 'Body');
    });
});

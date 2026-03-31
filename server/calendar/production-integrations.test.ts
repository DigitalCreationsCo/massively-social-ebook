import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CalendarService } from '.';
import { sendEmail, sendPushNotification } from '../notifications';
import { google } from 'googleapis';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { Resend } from 'resend';
import * as admin from 'firebase-admin';

// Mock External SDKs
vi.mock('googleapis', () => ({
    google: {
        auth: {
            JWT: vi.fn().mockImplementation(function () {
                return {};
            })
        },
        calendar: vi.fn().mockReturnValue({
            events: {
                insert: vi.fn().mockResolvedValue({ data: { id: 'evt_123' } })
            }
        })
    }
}));

vi.mock('@microsoft/microsoft-graph-client', () => ({
    Client: {
        init: vi.fn().mockReturnValue({
            api: vi.fn().mockReturnThis(),
            post: vi.fn().mockResolvedValue({ id: 'outlook_123' })
        })
    }
}));

vi.mock('@azure/identity', () => ({
    ClientSecretCredential: vi.fn().mockImplementation(function () {
        return {
            getToken: vi.fn().mockResolvedValue({ token: 'fake_token' })
        };
    })
}));

vi.mock('resend', () => {
    const mockSend = vi.fn().mockResolvedValue({ data: { id: 'resend_123' }, error: null });
    return {
        Resend: vi.fn().mockImplementation(function() {
            return {
                emails: {
                    send: mockSend
                }
            };
        })
    };
});
vi.mock('firebase-admin', () => ({
    initializeApp: vi.fn(),
    credential: {
        cert: vi.fn()
    },
    messaging: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue('push_123')
    }),
    apps: []
}));

describe('Production-Ready Integrations', () => {
    const mockSession = {
        id: 1,
        title: 'Test Session',
        description: 'Test Desc',
        scheduledStart: new Date(),
        scheduledEnd: new Date(),
        channelId: 'scifi',
        status: 'scheduled'
    } as any;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset process.env for each test
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@google.com';
        process.env.GOOGLE_PRIVATE_KEY = 'fake_key';
        process.env.AZURE_CLIENT_ID = 'az_id';
        process.env.AZURE_CLIENT_SECRET = 'az_secret';
        process.env.AZURE_TENANT_ID = 'az_tenant';
        process.env.AZURE_USER_ID = 'az_user_id';
        process.env.RESEND_API_KEY = 'resend_key';
        process.env.RESEND_FROM_EMAIL = 'from@test.com';
        process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'fb-test' });
    });

    describe('CalendarService', () => {
        it('should call Google Calendar API with correct parameters', async () => {
            await CalendarService.addToGoogle('user@test.com', mockSession);
            expect(google.calendar).toHaveBeenCalled();
            const calendar = (google.calendar as any).mock.results[ 0 ].value;
            expect(calendar.events.insert).toHaveBeenCalledWith(expect.objectContaining({
                calendarId: 'primary',
                requestBody: expect.objectContaining({
                    summary: expect.stringContaining(mockSession.title),
                    attendees: [ { email: 'user@test.com' } ]
                })
            }));
        });

        it('should call Microsoft Graph API with correct parameters', async () => {
            await CalendarService.addToOutlook('user@test.com', mockSession);
            expect(ClientSecretCredential).toHaveBeenCalledWith('az_tenant', 'az_id', 'az_secret');
            expect(Client.init).toHaveBeenCalled();
            const client = (Client.init as any).mock.results[ 0 ].value;
            expect(client.api).toHaveBeenCalledWith('/users/az_user_id/events');
            expect(client.post).toHaveBeenCalledWith(expect.objectContaining({
                subject: expect.stringContaining(mockSession.title),
                attendees: [ expect.objectContaining({
                    emailAddress: { address: 'user@test.com' }
                }) ]
            }));
        });
    });

    describe('NotificationService', () => {
        it('should call Resend API', async () => {
            await sendEmail('user@test.com', 'Sub', 'Body');
            
            const resendInstance = new Resend('fake_key');
            expect(resendInstance.emails.send).toHaveBeenCalledWith(expect.objectContaining({
                to: 'user@test.com',
                from: 'from@test.com',
                subject: 'Sub',
                text: 'Body'
            }));
        });
        it('should call Firebase Messaging API', async () => {
            // Mocking admin.apps to simulate initialized state
            (admin.apps as any).push({});

            await sendPushNotification('token123', 'Push Title', 'Push Body');
            expect(admin.messaging().send).toHaveBeenCalledWith(expect.objectContaining({
                notification: { title: 'Push Title', body: 'Push Body' },
                token: 'token123'
            }));

            (admin.apps as any).pop();
        });
    });
});

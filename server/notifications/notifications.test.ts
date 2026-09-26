import { storage } from '../storage';
import { sendEmail, sendPushNotification } from '.';
import { checkAndSendPushWarnings, dispatchWeeklyBriefing } from '../sessions/scheduler';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CalendarService } from '../calendar';
import { render } from '@react-email/render';
import { Resend } from 'resend';

vi.mock('../storage', () => ({
    storage: {
        getUsers: vi.fn(),
        listSessions: vi.fn(),
        createSession: vi.fn(),
        // The scheduler reads its watermark cursor through this and queries
        // sessions via getGlobalSessionsInWindow; without them the module throws
        // before the behaviour under test is reached.
        getSystemSetting: vi.fn(),
        setSystemSetting: vi.fn(),
        getGlobalSessionsInWindow: vi.fn(),
    },
}));

// Partial mock: sendEmail is the subject under test here and must be the real
// implementation talking to the mocked Resend client. Only the push path is
// stubbed, so the scheduler tests can assert on it without a Firebase project.
vi.mock('.', async (importOriginal) => {
    const actual = await importOriginal<typeof import('.')>();
    return {
        ...actual,
        // A spy over the real implementation, so this file can both assert on
        // the call (CalendarService, scheduler) and on the Resend interaction
        // (Notifications suite). vi.clearAllMocks() clears call records without
        // discarding the wrapped implementation.
        sendEmail: vi.fn(actual.sendEmail),
        sendPushNotification: vi.fn(),
    };
});

vi.mock('@react-email/render', () => ({
    render: vi.fn().mockResolvedValue('<html lang="en">Mock Email</html>'),
}));

// Hoisted mock to intercept top-level Resend initialization
vi.mock('resend', () => {
    const mockMethodSend = vi.fn();
    return {
        // A `function` expression, not an arrow: the test constructs the client
        // with `new Resend()`, and arrow functions are not constructable.
        Resend: vi.fn().mockImplementation(function ResendMock() {
            return {
                emails: {
                    send: mockMethodSend,
                },
            };
        }),
    };
});

describe('Notifications Service Test Suite', () => {
    const stringAddressTo = 'user@domain.com';
    const stringSubject = 'Midnight Alibi Update';
    const stringBodyText = 'Plain text fallback content.';
    const stringBodyHtml = '<b>HTML format content.</b>';

    let envCacheOriginal: NodeJS.ProcessEnv;
    let mockClientResend: any;

    beforeEach(() => {
        vi.clearAllMocks();
        // Cache environment state to prevent test contamination
        envCacheOriginal = { ...process.env };

        // Extract the mocked instance to inspect call arguments
        mockClientResend = new Resend();
    });

    afterEach(() => {
        // Restore environment state
        process.env = envCacheOriginal;
    });

    it('should bypass Resend and execute mock dispatch when API key is absent', async () => {
        delete process.env.RESEND_API_KEY;

        const responseExecution = await sendEmail(stringAddressTo, stringSubject, stringBodyText);

        expect(mockClientResend.emails.send).not.toHaveBeenCalled();
        expect(responseExecution.success).toBe(true);
        expect(responseExecution.messageId).toContain('mock-email-');
    });

    it('should transmit full payload to Resend when API key is present', async () => {
        process.env.RESEND_API_KEY = 're_test_key_123';
        process.env.RESEND_FROM_EMAIL = 'test@25thchapter.com';

        mockClientResend.emails.send.mockResolvedValue({
            data: { id: 'msg_success_123' },
            error: null
        });

        const responseExecution = await sendEmail(stringAddressTo, stringSubject, stringBodyText, stringBodyHtml);

        expect(mockClientResend.emails.send).toHaveBeenCalledWith({
            from: 'test@25thchapter.com',
            to: stringAddressTo,
            subject: stringSubject,
            text: stringBodyText,
            html: stringBodyHtml,
        });
        expect(responseExecution.success).toBe(true);
        expect(responseExecution.messageId).toBe('msg_success_123');
    });

    it('should aggressively throw an uncaught error when Resend API rejects the payload', async () => {
        process.env.RESEND_API_KEY = 're_test_key_123';

        const objectErrorResend = { message: 'Domain unverified' };
        mockClientResend.emails.send.mockResolvedValue({
            data: null,
            error: objectErrorResend
        });

        await expect(sendEmail(stringAddressTo, stringSubject, stringBodyText))
            .rejects
            .toThrow('Resend API Error: Domain unverified');
    });

    it('should properly format the text body fallback into HTML when stringBodyHtml is absent', async () => {
        process.env.RESEND_API_KEY = 're_test_key_123';
        mockClientResend.emails.send.mockResolvedValue({ data: { id: '123' }, error: null });

        const stringBodyTextMultiline = 'Line 1\nLine 2';
        await sendEmail(stringAddressTo, stringSubject, stringBodyTextMultiline);

        expect(mockClientResend.emails.send).toHaveBeenCalledWith(
            expect.objectContaining({
                text: 'Line 1\nLine 2',
                html: 'Line 1<br>Line 2'
            })
        );
    });
});

describe('CalendarService Test Suite', () => {
    const mockSessionValid = {
        id: 'session-123',
        title: 'Midnight Alibi: Case 08',
        description: 'A new mystery unfolds.',
        scheduledStart: new Date('2026-03-08T12:00:00Z'),
        scheduledEnd: new Date('2026-03-08T13:00:00Z'),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should successfully parse dates, render HTML, and execute sendEmail', async () => {
        const responseExecution = await CalendarService.sendCalendarInviteViaEmail('test@domain.com', mockSessionValid as any);

        expect(render).toHaveBeenCalled();
        expect(sendEmail).toHaveBeenCalledWith(
            'test@domain.com',
            'Calendar Invite: Midnight Alibi: Case 08',
            // The plain-text fallback is link-first: the styled links live in the
            // HTML, so the text version has to carry the URL itself or a text-only
            // client has no way in. Assert the URL, not some older wording.
            expect.stringContaining('https://25thchapter.com'),
            '<html lang="en">Mock Email</html>',
            expect.arrayContaining([
                expect.objectContaining({ filename: 'invite.ics' })
            ])
        );
    });

    it('should aggressively throw an error if unhydrated invalid string is passed', async () => {
        const mockSessionInvalid = {
            ...mockSessionValid,
            scheduledStart: 'invalid-date-string'
        };

        await expect(CalendarService.sendCalendarInviteViaEmail('test@domain.com', mockSessionInvalid as any))
            .rejects
            .toThrow('[CalendarService] Invalid date format encountered: invalid-date-string');
    });
});

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

        vi.mocked(storage.getGlobalSessionsInWindow).mockResolvedValue([mockSession] as any);
        vi.mocked(storage.getSystemSetting).mockResolvedValue(undefined);
        // getUsers returns { users: [...], total: number }
        vi.mocked(storage.getUsers).mockResolvedValue({ users: [mockUser], total: 1 });

        await checkAndSendPushWarnings();

        expect(sendPushNotification).toHaveBeenCalledWith(
            'token-123',
            '5 Minutes to Go-Time',
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

        // The weekly briefing reads the whole schedule via listSessions, unlike
        // the push path which uses the windowed query.
        vi.mocked(storage.listSessions).mockResolvedValue([mockSession] as any);
        // getUsers returns { users: [...], total: number }
        vi.mocked(storage.getUsers).mockResolvedValue({ users: [mockUser], total: 1 });

        await dispatchWeeklyBriefing();

expect(sendEmail).toHaveBeenCalledWith(
'test@example.com',
'Your Weekly 25th Chapter Schedule',
            expect.stringContaining('Sunday Story'),
            expect.any(String)
);
    });
});


import { sendEmail } from './notifications';
import { google } from 'googleapis';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import 'isomorphic-fetch';
import { type Session } from "@shared/schema";
import { generateICS } from './ics';

/**
 * Service for production-ready calendar API integrations.
 * Uses Service Accounts and Client Credentials to push events to users.
 */
export class CalendarService {
    /**
     * Sends an email via Resend with the calendar invite (.ics) attached.
     */
    static async sendCalendarInviteViaEmail(userEmail: string, session: Session) {
        try {
            const icsContent = CalendarService.generateIcs(session);
            const subject = `Calendar Invite: ${session.title}`;
            const body = `You are invited to join the story session: ${session.title}\n\n${session.description}\n\nJoin here: ${process.env.APP_URL || 'http://localhost:3000'}`;
            
            await sendEmail(userEmail, subject, body, [
                {
                    filename: 'invite.ics',
                    content: Buffer.from(icsContent, 'utf-8'),
                    contentType: 'text/calendar'
                }
            ]);
            return { success: true, provider: 'email' };
        } catch (err) {
            console.error('[Calendar] Error sending email invite:', err);
            throw err;
        }
    }
    /**
     * Invites a user to a Google Calendar event created by the service account.
     */
    static async addToGoogle(userEmail: string, session: Session) {
        if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
            console.warn('[Calendar] Google credentials missing, skipping...');
            return { success: false, reason: 'unconfigured' };
        }

        const auth = new google.auth.JWT({
            email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            scopes: [ 'https://www.googleapis.com/auth/calendar' ]
        });

        const calendar = google.calendar({ version: 'v3', auth });

        const event = {
            summary: `The 25th Chapter: ${session.title}`,
            description: `${session.description}\n\nJoin the story live at: ${process.env.APP_URL || 'http://localhost:3000'}`,
            start: { dateTime: session.scheduledStart.toISOString() },
            end: { dateTime: session.scheduledEnd.toISOString() },
            attendees: [ { email: userEmail } ],
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'email', minutes: 15 },
                    { method: 'popup', minutes: 5 },
                ],
            },
        };

        try {
            console.log(`[Calendar] Creating Google event for ${userEmail}`);
            await calendar.events.insert({
                calendarId: 'primary',
                requestBody: event,
                sendUpdates: 'all',
            });
            return { success: true, provider: 'google' };
        } catch (err) {
            console.error('[Calendar] Google API Error:', err);
            throw err;
        }
    }

    /**
     * Creates an event in Outlook and invites the user.
     */
    static async addToOutlook(userEmail: string, session: Session) {
        if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_CLIENT_SECRET || !process.env.AZURE_TENANT_ID || !process.env.AZURE_USER_ID) {
            console.warn('[Calendar] Azure credentials missing (requires ClientID, Secret, TenantID, and UserID), skipping...');
            return { success: false, reason: 'unconfigured' };
        }

        try {
            // Principal Engineer Note: Authenticate as the application using Client Credentials
            const credential = new ClientSecretCredential(
                process.env.AZURE_TENANT_ID,
                process.env.AZURE_CLIENT_ID,
                process.env.AZURE_CLIENT_SECRET
            );

            // Fetch token for Microsoft Graph
            const authProvider = async (done: (err: Error | null, token: string) => void) => {
                try {
                    const token = await credential.getToken("https://graph.microsoft.com/.default");
                    done(null, token.token);
                } catch (err) {
                    done(err as Error, "");
                }
            };

            const client = Client.init({
                authProvider: authProvider,
            });

            const event = {
                subject: `The 25th Chapter: ${session.title}`,
                body: {
                    contentType: 'HTML',
                    content: `${session.description}<br><br><a href="${process.env.APP_URL || 'http://localhost:3000'}">Join the story live</a>`,
                },
                start: {
                    dateTime: session.scheduledStart.toISOString(),
                    timeZone: 'UTC',
                },
                end: {
                    dateTime: session.scheduledEnd.toISOString(),
                    timeZone: 'UTC',
                },
                attendees: [
                    {
                        emailAddress: {
                            address: userEmail,
                        },
                        type: 'required',
                    },
                ],
                reminderMinutesBeforeStart: 15,
                isReminderOn: true
            };

            console.log(`[Calendar] Creating Outlook event for ${userEmail} via service user ${process.env.AZURE_USER_ID}`);

            // Create event in the designated service user's calendar
            // Requirements: 'Calendars.ReadWrite' application permission in Azure portal
            await client.api(`/users/${process.env.AZURE_USER_ID}/events`).post(event);

            return { success: true, provider: 'outlook' };
        } catch (err) {
            console.error('[Calendar] Outlook API Error:', err);
            throw err;
        }
    }
    /**
     * Generates an ICS file content for a session.
     */
    static generateIcs(session: Session): string {
        return generateICS(session, process.env.APP_URL || 'http://localhost:3000');
    }
}

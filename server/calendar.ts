import { sendEmail } from './notifications';
import { google } from 'googleapis';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { render } from '@react-email/render';
import 'isomorphic-fetch';
import { type Session } from "@shared/schema";
import { generateICS } from './ics';
import TemplateCalendarInvite from './emails/TemplateCalendarInvite';

export class CalendarService {

    /**
     * Helper to guarantee native Date objects and prevent hydration crashes.
     */
    private static parseDateStrict(valueDate: Date | string): Date {
        const objectDate = new Date(valueDate);
        if (isNaN(objectDate.getTime())) {
            throw new Error(`[CalendarService] Invalid date format encountered: ${valueDate}`);
        }
        return objectDate;
    }

    static generateCalendarUrls(session: Session, urlAppBase: string) {
        const start = new Date(session.scheduledStart).toISOString().replace(/-|:|\.\d\d\d/g, "");
        const end = new Date(session.scheduledEnd).toISOString().replace(/-|:|\.\d\d\d/g, "");
        const title = encodeURIComponent(`The 25th Chapter: ${session.title}`);
        const details = encodeURIComponent(`${session.description}\n\nJoin: ${urlAppBase}`);

        return {
            google: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}`,
            outlook: `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${title}&startdt=${start}&enddt=${end}&body=${details}`,
            office365: `https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${title}&startdt=${start}&enddt=${end}&body=${details}`
        };
    }

    static async sendCalendarInviteViaEmail(userEmail: string, session: Session) {
        const urlAppBase = process.env.APP_URL || 'http://localhost:3000';
        const calendarLinks = this.generateCalendarUrls(session, urlAppBase);
        const contentIcsString = this.generateIcs(session);

        const contentHtmlString = await render(
            TemplateCalendarInvite({ dataSession: session, urlAppBase, calendarLinks })
        );

        // Link-first: The links are in the HTML. Attachment is the fallback.
        await sendEmail(
            userEmail,
            `Reminder: ${session.title}`,
            `Join the session: ${urlAppBase}`,
            contentHtmlString,
            [ {
                filename: 'invite.ics',
                content: Buffer.from(contentIcsString, 'utf-8'),
                contentType: 'text/calendar'
            } ]
        );
    }

    static async addToGoogle(userEmail: string, session: Session) {
        console.debug(`[CalendarService][addToGoogle] Initiating Google event creation for user: ${userEmail}`);

        if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
            console.warn('[CalendarService][addToGoogle] Google credentials absent. Bypassing execution.');
            return { success: false, reason: 'unconfigured' };
        }

        try {
            const dateScheduledStart = this.parseDateStrict(session.scheduledStart);
            const dateScheduledEnd = this.parseDateStrict(session.scheduledEnd);

            const clientAuthGoogle = new google.auth.JWT({
                email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                scopes: [ 'https://www.googleapis.com/auth/calendar' ]
            });

            const clientCalendarGoogle = google.calendar({ version: 'v3', auth: clientAuthGoogle });

            const paramsRequestBodyEvent = {
                summary: `The 25th Chapter: ${session.title}`,
                description: `${session.description}\n\nJoin the story live at: ${process.env.APP_URL || 'https://25thchapter.com'}`,
                start: { dateTime: dateScheduledStart.toISOString() },
                end: { dateTime: dateScheduledEnd.toISOString() },
                attendees: [ { email: userEmail } ],
                reminders: {
                    useDefault: false,
                    overrides: [
                        { method: 'email', minutes: 15 },
                        { method: 'popup', minutes: 5 },
                    ],
                },
            };

            await clientCalendarGoogle.events.insert({
                calendarId: 'primary',
                requestBody: paramsRequestBodyEvent,
                sendUpdates: 'all',
            });

            console.debug(`[CalendarService][addToGoogle] Successfully created Google event for ${userEmail}.`);
            return { success: true, provider: 'google' };
        } catch (errorUncaught) {
            console.error(`[CalendarService][addToGoogle] CRITICAL FAILURE calling Google API for ${userEmail}:`, errorUncaught);
            throw errorUncaught;
        }
    }

    static async addToOutlook(userEmail: string, session: Session) {
        console.debug(`[CalendarService][addToOutlook] Initiating Outlook event creation for user: ${userEmail}`);

        if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_CLIENT_SECRET || !process.env.AZURE_TENANT_ID || !process.env.AZURE_USER_ID) {
            console.warn('[CalendarService][addToOutlook] Azure credentials absent. Bypassing execution.');
            return { success: false, reason: 'unconfigured' };
        }

        try {
            const dateScheduledStart = this.parseDateStrict(session.scheduledStart);
            const dateScheduledEnd = this.parseDateStrict(session.scheduledEnd);

            // Format constraint: MS Graph requires YYYY-MM-DDTHH:mm:ss without the trailing 'Z' when timeZone is UTC.
            const stringIsoStartGraph = dateScheduledStart.toISOString().split('.')[ 0 ];
            const stringIsoEndGraph = dateScheduledEnd.toISOString().split('.')[ 0 ];

            const credentialAzureClient = new ClientSecretCredential(
                process.env.AZURE_TENANT_ID,
                process.env.AZURE_CLIENT_ID,
                process.env.AZURE_CLIENT_SECRET
            );

            const providerAuthGraph = async (done: (err: Error | null, token: string) => void) => {
                try {
                    const responseToken = await credentialAzureClient.getToken("https://graph.microsoft.com/.default");
                    done(null, responseToken.token);
                } catch (errorToken) {
                    done(errorToken as Error, "");
                }
            };

            const clientGraphMicrosoft = Client.init({ authProvider: providerAuthGraph });

            const paramsRequestBodyEvent = {
                subject: `The 25th Chapter: ${session.title}`,
                body: {
                    contentType: 'HTML',
                    content: `${session.description}<br><br><a href="${process.env.APP_URL || 'http://localhost:3000'}">Join the story live</a>`,
                },
                start: { dateTime: stringIsoStartGraph, timeZone: 'UTC' },
                end: { dateTime: stringIsoEndGraph, timeZone: 'UTC' },
                attendees: [
                    { emailAddress: { address: userEmail }, type: 'required' }
                ],
                reminderMinutesBeforeStart: 15,
                isReminderOn: true
            };

            await clientGraphMicrosoft.api(`/users/${process.env.AZURE_USER_ID}/events`).post(paramsRequestBodyEvent);

            console.debug(`[CalendarService][addToOutlook] Successfully created Outlook event for ${userEmail}.`);
            return { success: true, provider: 'outlook' };
        } catch (errorUncaught) {
            console.error(`[CalendarService][addToOutlook] CRITICAL FAILURE calling Microsoft Graph API for ${userEmail}:`, errorUncaught);
            throw errorUncaught;
        }
    }

    static generateIcs(session: Session): string {
        const dateScheduledStart = this.parseDateStrict(session.scheduledStart);
        // Guarantee hydration before passing down to purely sync functions
        const objectSessionHydrated = { ...session, scheduledStart: dateScheduledStart, scheduledEnd: this.parseDateStrict(session.scheduledEnd) };
        return generateICS(objectSessionHydrated, process.env.APP_URL || 'http://localhost:3000');
    }
}
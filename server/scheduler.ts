import cron from 'node-cron';
import { storage } from './storage';
import { CHANNELS, type Channel } from '@shared/channels';
import { sendEmail, sendPushNotification } from './notifications';

/**
 * Automatically schedules daily sessions for all channels.
 * Sessions are scheduled to start at 19:00 (7 PM) and 20:00 (8 PM) local time (server time).
 * Each session lasts 25 minutes.
 */
export function startRecurringScheduler() {
    console.log('[Scheduler] Initializing recurring session scheduler...');

    // 1. Session Seeding: Run every day at 00:01
    cron.schedule('1 0 * * *', async () => {
        console.log('[Scheduler] Running daily session seeding...');
        await seedDailySessions();
    });

    // 2. Weekly Email Briefing: Every Sunday at 15:00 (3:00 PM)
    cron.schedule('0 15 * * 0', async () => {
        console.log('[Scheduler] Running weekly Sunday briefing...');
        await dispatchWeeklyBriefing();
    });

    // 3. 5-Minute Warning (Push Notifications): Every minute
    cron.schedule('* * * * *', async () => {
        await checkAndSendPushWarnings();
    });

    // Also run on startup to ensure we have sessions for today
    seedDailySessions().catch(err => {
        console.error('[Scheduler] Initial seeding failed:', err);
    });
}

export async function seedDailySessions() {
    const now = new Date();
    
    for (const channelId of CHANNELS) {
        // Check if we already have sessions scheduled for today
        const existing = await storage.listSessions(channelId, 'scheduled');
        const todaySessions = existing.filter(s => {
            const start = new Date(s.scheduledStart);
            return start.getFullYear() === now.getFullYear() &&
                   start.getMonth() === now.getMonth() &&
                   start.getDate() === now.getDate();
        });

        if (todaySessions.length === 0) {
            console.log(`[Scheduler] Seeding sessions for ${channelId} for ${now.toDateString()}`);
            
            // Schedule one session for tonight
            // Sci-fi at 19:00, Mystery at 20:00
            const hour = channelId === 'scifi' ? 19 : 20;
            const start = new Date(now);
            start.setHours(hour, 0, 0, 0);
            
            const end = new Date(start.getTime() + 25 * 60 * 1000); // 25 minutes later

            const title = channelId === 'scifi' 
                ? `Galactic Horizon: Entry ${now.getDate()}`
                : `Midnight Alibi: Case ${now.getDate()}`;
            
            const description = channelId === 'scifi'
                ? "The journey across the stars continues. What awaits the crew in the deep void?"
                : "A new mystery unfolds in the heart of the foggy city. Can you spot the clues?";

            try {
                await storage.createSession({
                    channelId,
                    title,
                    description,
                    scheduledStart: start,
                    scheduledEnd: end
                });
                console.log(`[Scheduler] Created session: ${title} at ${start.toLocaleTimeString()}`);
            } catch (err) {
                console.error(`[Scheduler] Failed to create session for ${channelId}:`, err);
            }
        } else {
            console.log(`[Scheduler] Sessions already exist for ${channelId} today.`);
        }
    }
}

export async function dispatchWeeklyBriefing() {
    const users = await storage.getUsers();
    if (users.length === 0) return;

    // Get all scheduled sessions for the next 7 days
    const allSessions = await storage.listSessions();
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const upcoming = allSessions.filter(s => {
        const start = new Date(s.scheduledStart);
        return start >= now && start <= nextWeek && s.status === 'scheduled';
    });

    if (upcoming.length === 0) {
        console.log('[Scheduler] No upcoming sessions for weekly briefing.');
        return;
    }

    const scheduleList = upcoming
        .map(s => `- ${s.title}: ${new Date(s.scheduledStart).toLocaleString()}`)
        .join('\n');

    const subject = "Your Weekly 25th Chapter Schedule";
    const body = `Hello reader,\n\nHere is your story schedule for the upcoming week:\n\n${scheduleList}\n\nJoin the global circle for your daily 25.\n\n- The 25th Chapter Team`;

    for (const user of users) {
        if (user.email) {
            await sendEmail(user.email, subject, body);
        }
    }
}

export async function checkAndSendPushWarnings() {
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    // We want to find sessions starting between 4m 30s and 5m 30s from now
    // to avoid missing a pulse or sending multiple times (though minute cron should be fine)
    const allSessions = await storage.listSessions();
    const startingSoon = allSessions.filter(s => {
        const start = new Date(s.scheduledStart).getTime();
        const diff = start - now.getTime();
        return diff > 4 * 60 * 1000 && diff <= 5 * 60 * 1000 && s.status === 'scheduled';
    });

    if (startingSoon.length === 0) return;

    const users = await storage.getUsers();

    for (const session of startingSoon) {
        console.log(`[Scheduler] Sending 5-minute warning for session: ${session.title}`);
        const title = "🔔 5 Minutes to Go-Time";
        const body = `Today's chapter is about to begin. Claim your seat now for your daily 25.`;

        for (const user of users) {
            if (user.pushToken) {
                await sendPushNotification(user.pushToken, title, body);
            }
        }
    }
}

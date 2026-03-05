import { storage } from './storage';
import { CHANNELS } from '@shared/channels';
import { sendEmail, sendPushNotification } from './notifications';
import { type Session } from '@shared/schema';
import { logger } from './logger';
import { getMSTDateString, createMSTDate, formatMST } from '@shared/date';

const CURSOR_KEY = 'notification_cursor';
const LOOP_INTERVAL_MS = 30 * 1000; // 30 seconds

type EventType = 'SESSION_WARNING_5MIN' | 'WEEKLY_BRIEF' | 'DAILY_SEEDING';

interface ScheduledEvent {
  type: EventType;
  targetId: string; // session ID or 'global'
  scheduledTime: number;
  expirationTime: number;
  payload?: any;
}

/**
 * Automatically schedules daily sessions for all channels.
 * Sessions are scheduled to start at 19:00 (7 PM) and 20:00 (8 PM) local time (server time).
 * Each session lasts 25 minutes.
 */
export function startRecurringScheduler() {
    logger.info('Starting deterministic stateless window loop', 'scheduler');

    // Initial seeding on startup (idempotent)
    seedDailySessions().catch(err => {
        logger.error('Initial seeding failed', 'scheduler', err instanceof Error ? err : new Error(String(err)));
    });

    setInterval(runNotificationLoop, LOOP_INTERVAL_MS);
}

async function runNotificationLoop() {
    try {
        const now = Date.now();

        // 1. Get cursor
        let lastProcessedStr = await storage.getSystemSetting(CURSOR_KEY);
        
        // If first run (no cursor), initialize to now and wait for next tick
        if (!lastProcessedStr) {
            await storage.setSystemSetting(CURSOR_KEY, now.toString());
            return;
        }

        let lastProcessed = parseInt(lastProcessedStr, 10);

        // 2. Define window (lastProcessed, now]
        // If now <= lastProcessed, nothing to do (clock skew or fast loop)
        if (now <= lastProcessed) return;

        const events = await getEventsInWindow(lastProcessed, now);

        // 3. Process events
        for (const event of events) {
            await processEvent(event, now);
        }

        // 4. Update cursor
        await storage.setSystemSetting(CURSOR_KEY, now.toString());

    } catch (err) {
        logger.error('Error in notification loop', 'scheduler', err instanceof Error ? err : new Error(String(err)));
    }
}

async function getEventsInWindow(start: number, end: number): Promise<ScheduledEvent[]> {
    const events: ScheduledEvent[] = [];

    // A. Session Warnings (Start - 5min)
    // We need sessions where (Start - 5min) is in (start, end]
    // => Start is in (start + 5min, end + 5min]
    const allSessions = await storage.listSessions(undefined, 'scheduled');

    for (const session of allSessions) {
        const sessionStart = new Date(session.scheduledStart).getTime();
        const warningTime = sessionStart - 5 * 60 * 1000;

        if (warningTime > start && warningTime <= end) {
            events.push({
                type: 'SESSION_WARNING_5MIN',
                targetId: session.id.toString(),
                scheduledTime: warningTime,
                expirationTime: sessionStart, // Expire when session starts
                payload: session
            });
        }
    }

    // B. Weekly Briefing (Sunday 15:00)
    let nextBriefing = getNextWeeklyBriefingTime(start);
    while (nextBriefing <= end) {
        events.push({
            type: 'WEEKLY_BRIEF',
            targetId: 'global_weekly_' + nextBriefing,
            scheduledTime: nextBriefing,
            expirationTime: nextBriefing + 24 * 60 * 60 * 1000 // Valid for 24 hours
        });
        nextBriefing = getNextWeeklyBriefingTime(nextBriefing);
    }

    // C. Daily Seeding (Daily 00:01)
    let nextSeeding = getNextDailySeedingTime(start);
    while (nextSeeding <= end) {
        events.push({
            type: 'DAILY_SEEDING',
            targetId: 'global_seeding_' + nextSeeding,
            scheduledTime: nextSeeding,
            expirationTime: nextSeeding + 1 * 60 * 60 * 1000 // Valid for 1 hour
        });
        nextSeeding = getNextDailySeedingTime(nextSeeding);
    }

    return events;
}

function getNextWeeklyBriefingTime(after: number): number {
    const date = new Date(after);
    const target = new Date(date);
    target.setHours(15, 0, 0, 0);

    // Adjust to Sunday
    const day = target.getDay();
    const diff = 0 - day; // 0 is Sunday
    target.setDate(target.getDate() + diff);

    // If target is before or equal to 'after', add 7 days
    if (target.getTime() <= after) {
        target.setDate(target.getDate() + 7);
    }
    return target.getTime();
}

function getNextDailySeedingTime(after: number): number {
    const target = new Date(after);
    target.setHours(0, 1, 0, 0);

    if (target.getTime() <= after) {
        target.setDate(target.getDate() + 1);
    }
    return target.getTime();
}

async function processEvent(event: ScheduledEvent, now: number) {
    // Check expiration
    if (now >= event.expirationTime) {
        logger.debug(`Event ${event.type} expired. Skipped.`, 'scheduler');
        await storage.createNotificationLog({
            type: event.type,
            targetId: event.targetId,
            status: 'skipped'
        });
        return;
    }

    // Check idempotency via logs
    const existing = await storage.getNotificationLog(event.type, event.targetId);
    if (existing && existing.status === 'sent') {
        return; // Already sent
    }

    try {
        if (event.type === 'SESSION_WARNING_5MIN') {
            await sendPushWarningsForSession(event.payload);
        } else if (event.type === 'WEEKLY_BRIEF') {
            await dispatchWeeklyBriefing();
        } else if (event.type === 'DAILY_SEEDING') {
            await seedDailySessions();
        }

        await storage.createNotificationLog({
            type: event.type,
            targetId: event.targetId,
            status: 'sent'
        });
    } catch (err) {
        logger.error(`Failed to process event ${event.type}`, 'scheduler', err instanceof Error ? err : new Error(String(err)));
        await storage.createNotificationLog({
            type: event.type,
            targetId: event.targetId,
            status: 'failed'
        });
    }
}

export async function seedDailySessions() {
    const now = new Date();

    for (const channelId of CHANNELS) {
        // Sci-fi at 19:00, Mystery at 20:00 (Mountain Time)
        // Schedule sessions at staggered times, e.g., 7 PM, 8 PM, etc.
        const baseHour = 19; // 7 PM MST
        const hour = baseHour + CHANNELS.indexOf(channelId);
        const durationMs = 25 * 60 * 1000; // 25 minutes
        
        // 1. Determine base target slot (the immediate next one)
        let baseTargetStart = createMSTDate(now, hour, 0, 0);
        const baseTargetEnd = new Date(baseTargetStart.getTime() + durationMs);

        // If today's slot has passed, the "next" slot starts tomorrow
        if (now > baseTargetEnd) {
            const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            baseTargetStart = createMSTDate(tomorrow, hour, 0, 0);
        }

        // 2. Ensure both "Next" (i=0) and "Following" (i=1) sessions exist
        for (let i = 0; i < 2; i++) {
            const targetStart = new Date(baseTargetStart.getTime() + i * 24 * 60 * 60 * 1000);
            const targetDateStr = getMSTDateString(targetStart);

            // Check existence (idempotent)
            // Check ALL sessions (scheduled, active, completed) to avoid duplicates
            // Optimization: We could cache this list outside the loop but it's fine for now
            const existing = await storage.listSessions(channelId);
            const sessionExists = existing.some(s => {
                const sDate = getMSTDateString(s.scheduledStart);
                return sDate === targetDateStr;
            });

            if (!sessionExists) {
                logger.info(`Seeding session for ${channelId} at ${formatMST(targetStart, "yyyy-MM-dd'T'HH:mm:ssXXX")} MST (Offset: ${i} days)`, 'scheduler');
                
                const end = new Date(targetStart.getTime() + durationMs);
                const dayOfMonth = targetDateStr.split('-')[2];
                
                const title = channelId === 'scifi' 
                    ? `Galactic Horizon: Entry ${dayOfMonth}`
                    : `Midnight Alibi: Case ${dayOfMonth}`;
                
                const description = channelId === 'scifi'
                    ? "The journey across the stars continues. What awaits the crew in the deep void?"
                    : "A new mystery unfolds in the heart of the foggy city. Can you spot the clues?";

                try {
                    await storage.createSession({
                        channelId,
                        title,
                        description,
                        scheduledStart: targetStart,
                        scheduledEnd: end
                    });
                    logger.info(`Created session: ${title}`, 'scheduler');
                } catch (err) {
                    logger.error(`Failed to create session for ${channelId}`, 'scheduler', err instanceof Error ? err : new Error(String(err)));
                }
            } else {
                 logger.debug(`Session already exists for ${channelId} on ${targetDateStr}`, 'scheduler');
            }
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
        logger.debug('No upcoming sessions for weekly briefing.', 'scheduler');
        return;
    }

    const scheduleList = upcoming
        .map(s => `- ${s.title}: ${formatMST(s.scheduledStart, "EEEE, MMMM do 'at' h:mm a")} MST`)
        .join('\n');

    const subject = "Your Weekly 25th Chapter Schedule";
    const body = `Hello reader,\n\nHere is your story schedule for the upcoming week:\n\n${scheduleList}\n\nJoin the global circle for your daily 25.\n\n- The 25th Chapter Team`;

    for (const user of users) {
        if (user.email) {
            await sendEmail(user.email, subject, body);
        }
    }
}

async function sendPushWarningsForSession(session: Session) {
    logger.info(`Sending 5-minute warning for session: ${session.title}`, 'scheduler');
    const users = await storage.getUsers();
    const title = "🔔 5 Minutes to Go-Time";
    const body = `Today's chapter is about to begin. Claim your seat now for your daily 25.`;

    for (const user of users) {
        if (user.pushToken) {
            await sendPushNotification(user.pushToken, title, body);
        }
    }
}

// Kept for compatibility if imported elsewhere, but now unused by the scheduler loop directly
export async function checkAndSendPushWarnings() {
    // This function is deprecated in favor of the event loop
    // But we can keep it as a manual trigger if needed
    const now = new Date();
    const allSessions = await storage.listSessions();
    const startingSoon = allSessions.filter(s => {
        const start = new Date(s.scheduledStart).getTime();
        const diff = start - now.getTime();
        return diff > 4 * 60 * 1000 && diff <= 5 * 60 * 1000 && s.status === 'scheduled';
    });

    for (const session of startingSoon) {
        await sendPushWarningsForSession(session);
    }
}

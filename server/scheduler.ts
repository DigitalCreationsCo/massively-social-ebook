import { storage } from './storage';
import { CHANNELS } from '@shared/channels';
import { sendEmail, sendPushNotification } from './notifications';
import { type Session, type Schedule } from '@shared/schema';
import { logger } from './logger';
import { getMSTDateString, createMSTDate, formatMST } from '@shared/date';

const CURSOR_KEY = 'notification_cursor';
const LOOP_INTERVAL_MS = 30 * 1000;

type EventType = 'SESSION_WARNING_5MIN' | 'WEEKLY_BRIEF' | 'DAILY_SEEDING';

interface ScheduledEvent {
  type: EventType;
  targetId: string;
  scheduledTime: number;
  expirationTime: number;
  payload?: any;
}

export function startRecurringScheduler() {
    logger.info('Starting deterministic stateless window loop', 'scheduler');

    seedDailySchedules().catch(err => {
        logger.error('Initial seeding failed', 'scheduler', err instanceof Error ? err : new Error(String(err)));
    });

    setInterval(runNotificationLoop, LOOP_INTERVAL_MS);
}

async function runNotificationLoop() {
    try {
        const now = Date.now();

        let lastProcessedStr = await storage.getSystemSetting(CURSOR_KEY);
        
        if (!lastProcessedStr) {
            await storage.setSystemSetting(CURSOR_KEY, now.toString());
            return;
        }

        let lastProcessed = parseInt(lastProcessedStr, 10);

        if (now <= lastProcessed) return;

        await processDueSchedules();
        const events = await getEventsInWindow(lastProcessed, now);

        for (const event of events) {
            await processEvent(event, now);
        }

        await storage.setSystemSetting(CURSOR_KEY, now.toString());

    } catch (err) {
        logger.error('Error in notification loop', 'scheduler', err instanceof Error ? err : new Error(String(err)));
    }
}

async function processDueSchedules() {
    const now = new Date();
    const dueSchedules = await storage.getDueSchedules(now);

    for (const schedule of dueSchedules) {
        try {
            const { start, end } = computeNextWindow(schedule);
            const title = deriveTitle(schedule, start);

            const session = await storage.createSession({
                channelId: schedule.channelId,
                scheduleId: schedule.id,
                title,
                description: `Auto-generated from schedule ${schedule.id}`,
                scheduledStart: start,
                scheduledEnd: end,
            });

            const nextRun = computeNextRunAt(schedule);
            await storage.updateScheduleNextRunAt(schedule.id, nextRun);

            logger.info(`Spawned session "${title}" from schedule ${schedule.id}`, 'scheduler');
        } catch (err) {
            logger.error(`Failed to process schedule ${schedule.id}`, 'scheduler', err instanceof Error ? err : new Error(String(err)));
        }
    }
}

function computeNextWindow(schedule: Schedule): { start: Date; end: Date } {
    const now = new Date();
    const [hours, minutes] = (schedule.scheduledTime || '19:00').split(':').map(Number);
    const durationMs = 25 * 60 * 1000;

    let targetDate = createMSTDate(now, hours, minutes, 0);

    if (schedule.scheduledDays && schedule.scheduledDays.length > 0) {
        const days = schedule.scheduledDays as string[];
        const nextDay = getNextScheduledDay(now, days);
        if (nextDay) {
            targetDate = createMSTDate(nextDay, hours, minutes, 0);
        }
    }

    if (targetDate <= now) {
        if (schedule.scheduledDays && schedule.scheduledDays.length > 0) {
            const days = schedule.scheduledDays as string[];
            const nextDay = getNextScheduledDay(new Date(now.getTime() + 24 * 60 * 60 * 1000), days);
            if (nextDay) {
                targetDate = createMSTDate(nextDay, hours, minutes, 0);
            }
        } else {
            targetDate = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
        }
    }

    const end = new Date(targetDate.getTime() + durationMs);
    return { start: targetDate, end };
}

function getNextScheduledDay(from: Date, days: string[]): Date | null {
    if (!days.length) return null;

    const dayMap: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
        thursday: 4, friday: 5, saturday: 6
    };

    const targetDays = days.map(d => dayMap[d.toLowerCase()]).filter(d => d !== undefined);
    if (!targetDays.length) return null;

    const currentDay = from.getDay();
    const currentMs = from.getTime();

    for (let i = 1; i <= 7; i++) {
        const checkDay = (currentDay + i) % 7;
        if (targetDays.includes(checkDay)) {
            const result = new Date(from);
            result.setDate(from.getDate() + i);
            result.setHours(0, 0, 0, 0);
            return result;
        }
    }

    return null;
}

export function computeNextRunAt(schedule: Schedule): Date {
    const now = new Date();
    const [hours, minutes] = (schedule.scheduledTime || '19:00').split(':').map(Number);

    if (schedule.scheduledDays && schedule.scheduledDays.length > 0) {
        const days = schedule.scheduledDays as string[];
        const nextDay = getNextScheduledDay(now, days);
        if (nextDay) {
            return createMSTDate(nextDay, hours, minutes, 0);
        }
    }

    let next = createMSTDate(now, hours, minutes, 0);
    if (next <= now) {
        next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
    }
    return next;
}

function deriveTitle(schedule: Schedule, start: Date): string {
    const dateStr = getMSTDateString(start);
    const dayOfMonth = dateStr.split('-')[2];
    const channelId = schedule.channelId;

    if (channelId === 'scifi') {
        return `Galactic Horizon: Entry ${dayOfMonth}`;
    } else if (channelId === 'mystery') {
        return `Midnight Alibi: Case ${dayOfMonth}`;
    }
    return `Session - ${dateStr}`;
}

async function getEventsInWindow(start: number, end: number): Promise<ScheduledEvent[]> {
    const events: ScheduledEvent[] = [];

    const allSessions = await storage.listSessions(undefined, 'scheduled');

    for (const session of allSessions) {
        const sessionStart = new Date(session.scheduledStart).getTime();
        const warningTime = sessionStart - 5 * 60 * 1000;

        if (warningTime > start && warningTime <= end) {
            events.push({
                type: 'SESSION_WARNING_5MIN',
                targetId: session.id.toString(),
                scheduledTime: warningTime,
                expirationTime: sessionStart,
                payload: session
            });
        }
    }

    let nextBriefing = getNextWeeklyBriefingTime(start);
    while (nextBriefing <= end) {
        events.push({
            type: 'WEEKLY_BRIEF',
            targetId: 'global_weekly_' + nextBriefing,
            scheduledTime: nextBriefing,
            expirationTime: nextBriefing + 24 * 60 * 60 * 1000
        });
        nextBriefing = getNextWeeklyBriefingTime(nextBriefing);
    }

    let nextSeeding = getNextDailySeedingTime(start);
    while (nextSeeding <= end) {
        events.push({
            type: 'DAILY_SEEDING',
            targetId: 'global_seeding_' + nextSeeding,
            scheduledTime: nextSeeding,
            expirationTime: nextSeeding + 1 * 60 * 60 * 1000
        });
        nextSeeding = getNextDailySeedingTime(nextSeeding);
    }

    return events;
}

function getNextWeeklyBriefingTime(after: number): number {
    const date = new Date(after);
    const target = new Date(date);
    target.setHours(15, 0, 0, 0);

    const day = target.getDay();
    const diff = 0 - day;
    target.setDate(target.getDate() + diff);

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
    if (now >= event.expirationTime) {
        logger.debug(`Event ${event.type} expired. Skipped.`, 'scheduler');
        await storage.createNotificationLog({
            type: event.type,
            targetType: 'session',
            targetId: event.targetId,
            status: 'skipped'
        });
        return;
    }

    const existing = await storage.getNotificationLog(event.type, event.targetId);
    if (existing && existing.status === 'sent') {
        return;
    }

    try {
        if (event.type === 'SESSION_WARNING_5MIN') {
            await sendPushWarningsForSession(event.payload);
        } else if (event.type === 'WEEKLY_BRIEF') {
            await dispatchWeeklyBriefing();
        } else if (event.type === 'DAILY_SEEDING') {
            await seedDailySchedules();
        }

        await storage.createNotificationLog({
            type: event.type,
            targetType: 'session',
            targetId: event.targetId,
            status: 'sent'
        });
    } catch (err) {
        logger.error(`Failed to process event ${event.type}`, 'scheduler', err instanceof Error ? err : new Error(String(err)));
        await storage.createNotificationLog({
            type: event.type,
            targetType: 'session',
            targetId: event.targetId,
            status: 'failed'
        });
    }
}

export async function seedDailySchedules() {
    const now = new Date();

    for (const channelId of CHANNELS) {
        const existing = await storage.getSchedulesByChannel(channelId);
        const hasSchedule = existing.some(s => s.intervalEnabled && s.scheduledDays);

        if (!hasSchedule) {
            const baseHour = 19;
            const hour = baseHour + CHANNELS.indexOf(channelId);

            const schedule = await storage.createSchedule({
                channelId,
                scheduledDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
                scheduledTime: `${hour.toString().padStart(2, '0')}:00`,
                intervalEnabled: true,
                timezone: 'America/Denver',
            });

            await storage.updateScheduleNextRunAt(schedule.id, computeNextRunAt(schedule));

            logger.info(`Created default schedule ${schedule.id} for channel ${channelId}`, 'scheduler');
        } else {
            logger.debug(`Schedule already exists for channel ${channelId}`, 'scheduler');
        }
    }
}

export async function dispatchWeeklyBriefing() {
    const { users } = await storage.getUsers();
    if (users.length === 0) return;

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
    const { users } = await storage.getUsers();
    const title = "5 Minutes to Go-Time";
    const body = `Today's chapter is about to begin. Claim your seat now for your daily 25.`;

    for (const user of users) {
        if (user.pushToken) {
            await sendPushNotification(user.pushToken, title, body);
        }
    }
}

export async function checkAndSendPushWarnings() {
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

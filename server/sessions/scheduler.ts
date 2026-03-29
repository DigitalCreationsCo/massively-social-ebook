import { storage } from '../storage';
import { sendEmail, sendPushNotification } from '../notifications';
import { type Session, type Schedule, type Channel } from '@shared/schema';
import { logger } from '../logger';
import { getMSTDateString, createMSTDate, formatMST } from '@shared/date';
import {
    computeTitleContext,
    deriveTitleFromConfig,
    type TitleConfig,
} from '@shared/title';

/**
 * Cursor key for tracking the last-processed timestamp in the notification loop.
 * Used to ensure events are processed exactly once and maintain idempotency.
 */
const CURSOR_KEY = 'notification_cursor';
const SEEDING_CURSOR_KEY = 'seeding_cursor';

/**
 * Interval at which the notification loop runs (every 30 seconds).
 */
const LOOP_INTERVAL_MS = 30 * 1000;
/**
 * Interval at which the seeding lookahead loop runs (every 30 minutes).
 */
const SEEDING_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Maximum number of days into the future to pre-schedule sessions.
 * Sessions will be created for any scheduled days within this window that don't already have sessions.
 */
const SESSION_LOOKAHEAD_DAYS = 7;

/**
 * Event types for scheduled notifications.
 * - SESSION_WARNING_5MIN: Push notification sent 5 minutes before a session starts
 * - WEEKLY_BRIEF: Email summary of upcoming sessions sent weekly (Monday 3pm MST)
 * - DAILY_SEEDING: DEPRECATED - retained for backwards compatibility
 */
type EventType = 'SESSION_WARNING_5MIN' | 'WEEKLY_BRIEF' | 'DAILY_SEEDING';

/**
 * Represents a scheduled event that needs to be processed by the notification loop.
 */
interface ScheduledEvent {
    type: EventType;
    targetId: string;
    scheduledTime: number;
    expirationTime: number;
    payload?: unknown;
}

/**
 * Starts the recurring scheduler.
 *
 * Initializes the scheduler loop and performs initial seeding of schedules if none exist.
 * This function should be called once at server startup.
 *
 * @example
 * ```typescript
 * startRecurringScheduler();
 * ```
 */
export function startRecurringScheduler(): void {
    logger.info('Starting deterministic stateless window loop', 'scheduler');

    seedDefaultSchedulesIfEmpty().catch(err => {
        logger.error('Initial seeding failed', 'scheduler', err instanceof Error ? err : new Error(String(err)));
    });

    setInterval(runNotificationLoop, LOOP_INTERVAL_MS);
}

/**
 * Main notification processing loop.
 *
 * Runs every 30 seconds to:
 * 1. Process any schedules that are due (create sessions)
 * 2. Ensure sessions exist within the 7-day lookahead window
 * 3. Process notification events within the window
 * 4. Update the cursor to track processed time
 *
 * Uses a cursor-based approach to ensure idempotency - events are only processed once.
 */
async function runNotificationLoop(): Promise<void> {
    try {
        const now = Date.now();

        let lastProcessedStr = await storage.getSystemSetting(CURSOR_KEY);

        if (!lastProcessedStr) {
            await storage.setSystemSetting(CURSOR_KEY, now.toString());
            return;
        }

        let lastProcessed = parseInt(lastProcessedStr, 10);

        if (now <= lastProcessed) return;

        // Process due schedules (create sessions for schedules whose nextRunAt has passed)
        await processDueSchedules();

        // Ensure sessions exist within the 7-day lookahead window (EVERY 30 MINUTES)
        const lastSeedingStr = await storage.getSystemSetting(SEEDING_CURSOR_KEY);
        const lastSeeding = lastSeedingStr ? parseInt(lastSeedingStr, 10) : 0;
        if (now - lastSeeding >= SEEDING_INTERVAL_MS) {
            await ensureSessionsExistWithinLookahead();
            await storage.setSystemSetting(SEEDING_CURSOR_KEY, now.toString());
        }

        // Process notification events (push warnings, weekly briefings)
        const events = await getEventsInWindow(lastProcessed, now);

        for (const event of events) {
            await processEvent(event, now);
        }

        await storage.setSystemSetting(CURSOR_KEY, now.toString());

    } catch (err) {
        logger.error('Error in notification loop', 'scheduler', err instanceof Error ? err : new Error(String(err)));
    }
}

/**
 * Processes all schedules whose nextRunAt timestamp has passed.
 *
 * For each due schedule:
 * 1. Computes the next session window (start/end times)
 * 2. Derives the session title using the schedule's titleConfig
 * 3. Creates the session in the database
 * 4. Increments the schedule's sessionCount
 * 5. Computes and updates the schedule's nextRunAt
 *
 * @internal
 */
async function processDueSchedules(): Promise<void> {
    const now = new Date();
    const dueSchedules = await storage.getDueSchedules(now);

     for (const schedule of dueSchedules) {
        try {
            const { start, end } = computeNextWindow(schedule);

            // Session number is incremented sessionCount + 1 (1-based, never 0)
            const nextSessionNumber = (schedule.sessionCount ?? 0) + 1;

            // Get channel information for title and description
            const channel = await storage.getChannel(schedule.channelId);

            const title = buildSessionTitle(schedule, nextSessionNumber, start, channel);

            // Compute seasonal position for the session (stored for cheap querying)
            const config = schedule.titleConfig as TitleConfig | null;
            const seasonSize = config?.seasonSize ?? 30;
            const seasonNumber = Math.floor((nextSessionNumber - 1) / seasonSize) + 1;
            const episodeNumber = ((nextSessionNumber - 1) % seasonSize) + 1;

            const session = await storage.createSessionWithScheduleUpdate({
                channelId: schedule.channelId,
                scheduleId: schedule.id,
                title,
                description: 'Upcoming session',
                scheduledStart: start,
                scheduledEnd: end,
                sessionNumber: nextSessionNumber,
                seasonNumber,
                episodeNumber,
                subtitle: null,
            }, schedule.id);

            // Compute and store the next run time
            const nextRun = computeNextRunAt(schedule);
            await storage.updateScheduleNextRunAt(schedule.id, nextRun);

            logger.info(`Spawned session "${title}" (S${seasonNumber} E${episodeNumber}) from schedule ${schedule.id}`, 'scheduler');
        } catch (err) {
            logger.error(`Failed to process schedule ${schedule.id}`, 'scheduler', err instanceof Error ? err : new Error(String(err)));
        }
    }
}

/**
 * Ensures all enabled schedules have sessions scheduled within the lookahead window.
 *
 * For each schedule with intervalEnabled = true:
 * 1. Get all sessions already created from this schedule
 * 2. Calculate all scheduled days (based on scheduledDays) within the next 7 days
 * 3. Create sessions for any days that don't already have sessions
 *
 * This replaces the old DAILY_SEEDING logic with smarter gap-filling.
 *
 * @internal
 */
async function ensureSessionsExistWithinLookahead(): Promise<void> {
    const allSchedules = await storage.listSchedules();
    const enabledSchedules = allSchedules.filter(s => s.intervalEnabled);

    for (const schedule of enabledSchedules) {
        try {
            // Get existing sessions for this schedule within the lookahead window
            const existingSessions = await storage.getSessionsBySchedule(schedule.id);
            const now = new Date();
            const lookaheadEnd = new Date(now.getTime() + SESSION_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

            // Filter to sessions within the lookahead window
            const upcomingSessions = existingSessions.filter(s => {
                const start = new Date(s.scheduledStart);
                return start >= now && start <= lookaheadEnd;
            });

            // Calculate all dates this schedule should run on within the window
            const scheduledDates = getScheduledDatesInWindow(schedule, now, lookaheadEnd);

            // Find gaps (dates with no session)
            const existingDates = new Set(upcomingSessions.map(s => {
                const d = new Date(s.scheduledStart);
                // Return YYYY-MM-DD for a robust date comparison
                return d.toISOString().split('T')[0];
            }));

            const gapDates = scheduledDates.filter(date => {
                const key = date.toISOString().split('T')[0];
                return !existingDates.has(key);
            });

            // Create sessions for each gap date
            for (const date of gapDates) {
                const { start, end } = computeNextWindowForDate(schedule, date);

                const nextSessionNumber = (schedule.sessionCount ?? 0) + 1;
                const title = buildSessionTitle(schedule, nextSessionNumber, start);

                const config = schedule.titleConfig as TitleConfig | null;
                const seasonSize = config?.seasonSize ?? 30;
                const seasonNumber = Math.floor((nextSessionNumber - 1) / seasonSize) + 1;
                const episodeNumber = ((nextSessionNumber - 1) % seasonSize) + 1;

                const session = await storage.createSessionWithScheduleUpdate({
                    channelId: schedule.channelId,
                    scheduleId: schedule.id,
                    title,
                    description: 'Upcoming session',
                    scheduledStart: start,
                    scheduledEnd: end,
                    sessionNumber: nextSessionNumber,
                    seasonNumber,
                    episodeNumber,
                    subtitle: null,
                }, schedule.id);

                await storage.updateScheduleNextRunAt(schedule.id, computeNextRunAt(schedule));

                logger.info(`Seeded session "${title}" (gap-fill) for schedule ${schedule.id}`, 'scheduler');
            }
        } catch (err) {
            logger.error(`Failed to ensure sessions for schedule ${schedule.id}`, 'scheduler', err instanceof Error ? err : new Error(String(err)));
        }
    }
}

/**
 * Gets all dates within a date range when the schedule should run.
 *
 * @param schedule - The schedule to calculate dates for
 * @param start - Start of the window (inclusive)
 * @param end - End of the window (inclusive)
 * @returns Array of Date objects when the schedule should run
 *
 * @internal
 */
function getScheduledDatesInWindow(schedule: Schedule, start: Date, end: Date): Date[] {
    const scheduledDays = schedule.scheduledDays as string[] | null;
    const [hours, minutes] = (schedule.scheduledTime || '19:00').split(':').map(Number);

    if (!scheduledDays || scheduledDays.length === 0) {
        // No days specified - fall back to daily
        const dates: Date[] = [];
        const current = new Date(start);
        current.setHours(0, 0, 0, 0);

        while (current <= end) {
            dates.push(createMSTDate(current, hours, minutes, 0));
            current.setDate(current.getDate() + 1);
        }
        return dates;
    }

    const dates: Date[] = [];
    const current = new Date(start);
    current.setHours(0, 0, 0, 0);

    while (current <= end) {
        const dayMap: Record<string, number> = {
            sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
            thursday: 4, friday: 5, saturday: 6
        };
        const targetDays = scheduledDays.map(d => dayMap[d.toLowerCase()]).filter(d => d !== undefined);

        if (targetDays.includes(current.getDay())) {
            dates.push(createMSTDate(current, hours, minutes, 0));
        }

        current.setDate(current.getDate() + 1);
    }

    return dates;
}

/**
 * Builds the session title from the schedule's TitleConfig.
 *
 * Falls back to the channel name when the schedule has no titleConfig and a channel is provided,
 * preserving backward-compatibility with schedules created before the title system.
 * If no channel is provided, falls back to a date-based title.
 *
 * @param schedule - The schedule to derive the title from
 * @param nextSessionNumber - The session number (1-based)
 * @param scheduledStart - The scheduled start time of the session
 * @param channel - The channel object (optional, for fallback title)
 * @returns The derived session title
 *
 * @internal
 */
function buildSessionTitle(
    schedule: Schedule,
    nextSessionNumber: number,
    scheduledStart: Date,
    channel?: Channel
): string {
    const config = schedule.titleConfig as TitleConfig | null;

    if (!config) {
        if (channel) {
            // Legacy fallback - use channel name
            return channel.name;
        } else {
            // Original legacy fallback
            const dateStr = getMSTDateString(scheduledStart);
            return `Session - ${dateStr}`;
        }
    }

    const ctx = computeTitleContext(nextSessionNumber, config, scheduledStart);
    return deriveTitleFromConfig(config, ctx);
}

/**
 * Computes the next session window (start and end times) based on the schedule's rules.
 *
 * Uses the schedule's scheduledDays and scheduledTime to find the next occurrence.
 * If the calculated time is in the past, advances to the next valid day.
 *
 * @param schedule - The schedule to compute the window for
 * @returns Object containing start and end Date objects
 *
 * @internal
 */
function computeNextWindow(schedule: Schedule): { start: Date; end: Date; } {
    const now = new Date();
    return computeNextWindowForDate(schedule, now);
}

/**
 * Computes the session window for a specific target date.
 *
 * @param schedule - The schedule to compute the window for
 * @param targetDate - The target date to compute the window around
 * @returns Object containing start and end Date objects
 *
 * @internal
 */
function computeNextWindowForDate(schedule: Schedule, targetDate: Date): { start: Date; end: Date; } {
    const [hours, minutes] = (schedule.scheduledTime || '19:00').split(':').map(Number);

    // Use durationMinutes from schedule if available, otherwise default to 25 minutes
    const durationMinutes = (schedule as unknown as { durationMinutes?: number }).durationMinutes ?? 25;
    const durationMs = durationMinutes * 60 * 1000;

    let date = createMSTDate(targetDate, hours, minutes, 0);

    // If scheduledDays is specified, find the next valid day
    if (schedule.scheduledDays && schedule.scheduledDays.length > 0) {
        const days = schedule.scheduledDays as string[];
        const nextDay = getNextScheduledDay(targetDate, days);
        if (nextDay) {
            date = createMSTDate(nextDay, hours, minutes, 0);
        }
    }

    // If the calculated date is in the past, advance to the next valid occurrence
    if (date <= targetDate) {
        if (schedule.scheduledDays && schedule.scheduledDays.length > 0) {
            const days = schedule.scheduledDays as string[];
            const nextDay = getNextScheduledDay(new Date(targetDate.getTime() + 24 * 60 * 60 * 1000), days);
            if (nextDay) {
                date = createMSTDate(nextDay, hours, minutes, 0);
            }
        } else {
            date = new Date(date.getTime() + 24 * 60 * 60 * 1000);
        }
    }

    const end = new Date(date.getTime() + durationMs);
    return { start: date, end };
}

/**
 * Finds the next date matching the specified days of the week.
 *
 * @param from - The starting date to search from
 * @param days - Array of day names (e.g., ['monday', 'friday'])
 * @returns The next Date matching one of the specified days, or null if none found
 *
 * @internal
 */
function getNextScheduledDay(from: Date, days: string[]): Date | null {
    if (!days.length) return null;

    const dayMap: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
        thursday: 4, friday: 5, saturday: 6
    };

    const targetDays = days.map(d => dayMap[d.toLowerCase()]).filter(d => d !== undefined);
    if (!targetDays.length) return null;

    const currentDay = from.getDay();

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

/**
 * Computes the next run timestamp for a schedule.
 *
 * @param schedule - The schedule to compute the next run for
 * @returns The next Date when the schedule should run
 *
 * @internal
 */
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

/**
 * Retrieves all notification events that should be processed within a time window.
 *
 * Events include:
 * - 5-minute warnings for sessions starting in the window
 * - Weekly briefing events (Monday 3pm MST)
 * - Daily seeding events (DEPRECATED, retained for backwards compatibility)
 *
 * @param start - Start of the window (timestamp)
 * @param end - End of the window (timestamp)
 * @returns Array of ScheduledEvent objects
 *
 * @internal
 */
async function getEventsInWindow(start: number, end: number): Promise<ScheduledEvent[]> {
    const events: ScheduledEvent[] = [];

    // Session 5-minute warnings
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

    // Weekly briefing events (Monday 3pm MST)
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

    // DEPRECATED: Daily seeding - retained for backwards compatibility
    // Now handled by ensureSessionsExistWithinLookahead()
    let nextSeeding = getNextDailySeedingTime(start);
    while (nextSeeding <= end) {
        events.push({
            type: 'DAILY_SEEDING',
            targetId: 'global_seeding_' + nextBriefing,
            scheduledTime: nextSeeding,
            expirationTime: nextSeeding + 1 * 60 * 60 * 1000
        });
        nextSeeding = getNextDailySeedingTime(nextSeeding);
    }

    return events;
}

/**
 * Calculates the next weekly briefing time (Monday 3pm MST).
 *
 * @param after - Timestamp to calculate from
 * @returns Timestamp of the next Monday 3pm MST
 *
 * @internal
 */
function getNextWeeklyBriefingTime(after: number): number {
    const date = new Date(after);
    const target = new Date(date);
    target.setHours(15, 0, 0, 0);

    const day = target.getDay();
    const diff = 0 - day; // Sunday = 0
    target.setDate(target.getDate() + diff);

    if (target.getTime() <= after) {
        target.setDate(target.getDate() + 7);
    }
    return target.getTime();
}

/**
 * Calculates the next daily seeding time (midnight + 1 minute MST).
 *
 * DEPRECATED: This function is retained for backwards compatibility but
 * the actual seeding is now handled by ensureSessionsExistWithinLookahead().
 *
 * @param after - Timestamp to calculate from
 * @returns Timestamp of the next daily seeding
 *
 * @internal
 */
function getNextDailySeedingTime(after: number): number {
    const target = new Date(after);
    target.setHours(0, 1, 0, 0);

    if (target.getTime() <= after) {
        target.setDate(target.getDate() + 1);
    }
    return target.getTime();
}

/**
 * Processes a single scheduled event.
 *
 * @param event - The event to process
 * @param now - Current timestamp for expiration checks
 *
 * @internal
 */
async function processEvent(event: ScheduledEvent, now: number): Promise<void> {
    // Skip if event has expired
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

    // Skip if already sent or previously failed
    const existing = await storage.getNotificationLog(event.type, event.targetId);
    if (existing && (existing.status === 'sent' || existing.status === 'failed')) {
        return;
    }

    try {
        if (event.type === 'SESSION_WARNING_5MIN') {
            await sendPushWarningsForSession(event.payload as Session);
        } else if (event.type === 'WEEKLY_BRIEF') {
            await dispatchWeeklyBriefing();
        } else if (event.type === 'DAILY_SEEDING') {
            // DEPRECATED: Now handled by ensureSessionsExistWithinLookahead()
            // Kept for backwards compatibility - no-op
            logger.debug('DAILY_SEEDING event received (deprecated)', 'scheduler');
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

/**
 * Seeds default schedules for any channel that doesn't have one.
 *
 * This function is called once at startup to ensure every channel has
 * at least one schedule. It creates a default schedule with:
 * - All days of the week
 * - Staggered start times per channel (19:00, 20:00, etc.)
 * - Default TitleConfig for title generation
 *
 * @internal
 */
export async function seedDefaultSchedulesIfEmpty(): Promise<void> {
    const channels = await storage.getChannels();

    for (let i = 0; i < channels.length; i++) {
        const channel = channels[i];
        const existing = await storage.getSchedulesByChannel(channel.channelId);


        const hasSchedule = existing.some(s => s.intervalEnabled && s.scheduledDays);
        const needsSeedSchedule = existing.some(s => s.intervalEnabled && !s.scheduledDays);

        if (needsSeedSchedule) {
            const baseHour = 19;
            const hour = baseHour + i;

            const defaultTitleConfig: TitleConfig = {
                format: 'numbered',
                programName: channel.name,
                sessionLabel: 'Day',
                numberSource: 'episode',
                seasonSize: 30,
                showSeason: false,
            };

            const schedule = await storage.createSchedule({
                channelId: channel.channelId,
                scheduledDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
                scheduledTime: `${hour.toString().padStart(2, '0')}:00`,
                intervalEnabled: true,
                timezone: 'America/Denver',
                titleConfig: defaultTitleConfig,
            });

            await storage.updateScheduleNextRunAt(schedule.id, computeNextRunAt(schedule));

            logger.info(`Created default schedule ${schedule.id} for channel ${channel.channelId}`, 'scheduler');
        } else {
            logger.debug(`Schedule already exists for channel ${channel.channelId}`, 'scheduler');
        }
    }
}

/**
 * Dispatches the weekly briefing email to all users.
 *
 * Sends an email with all scheduled sessions for the upcoming week.
 * Called automatically by the notification loop on Monday 3pm MST.
 *
 * @internal
 */
export async function dispatchWeeklyBriefing(): Promise<void> {
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

/**
 * Sends push notifications to all users 5 minutes before a session starts.
 *
 * @param session - The session that is about to start
 *
 * @internal
 */
async function sendPushWarningsForSession(session: Session): Promise<void> {
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

/**
 * Manual trigger for sending push warnings.
 *
 * Can be called manually or by a cron job to ensure warnings are sent.
 * Checks for sessions starting in the 4-5 minute window.
 *
 * @internal
 */
export async function checkAndSendPushWarnings(): Promise<void> {
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

// DEPRECATED: Export for backwards compatibility
// Use seedDefaultSchedulesIfEmpty() instead
export const seedDailySchedules = seedDefaultSchedulesIfEmpty;

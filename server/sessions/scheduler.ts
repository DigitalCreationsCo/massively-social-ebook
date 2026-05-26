import { storage } from '../storage';
import { sendEmail, sendPushNotification } from '../notifications';
import { type Session, type Schedule, type Channel } from '@shared/schema';
import { logger } from '../logger';
import { getDateStringInTZ, createZonedDate, formatInTZ, getYear, getISOWeek } from '@shared/date';
import {
    computeTitleContext,
    deriveTitleFromConfig,
    type TitleConfig,
} from '@shared/title';
import { render } from '@react-email/render';
import TemplateWeeklyBriefingEmail from '../emails/TemplateWeeklyBriefing';

/**
 * Cursor key for tracking the last-processed timestamp in the notification loop.
 * Used to ensure events are processed exactly once and maintain idempotency.
 */
const CURSOR_KEY = 'notification_cursor';
const SEEDING_CURSOR_KEY = 'seeding_cursor';

/**
 * Interval at which the fast loop runs (every 30 seconds).
 * Handles quick tasks: marking sessions as completed, processing due schedules.
 */
const FAST_LOOP_INTERVAL_MS = 30 * 1000;

/**
 * Interval at which the main loop runs (every 10 minutes).
 * Handles heavier tasks: session seeding, notification event processing.
 */
const MAIN_LOOP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Maximum number of days into the future to pre-schedule sessions.
 * Sessions will be created for any scheduled days within this window that don't already have sessions.
 */
const SESSION_LOOKAHEAD_DAYS = 7;

/**
 * Event types for scheduled notifications.
 * - SESSION_WARNING_5MIN: Push notification sent 5 minutes before a session starts
 * - WEEKLY_BRIEF: Email summary of upcoming sessions sent weekly (Monday 3pm MST)
 */
type EventType = 'SESSION_WARNING_5MIN' | 'WEEKLY_BRIEF';

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
 * Scheduler configuration for loop intervals.
 */
interface SchedulerConfig {
    fastLoopMs: number;
    mainLoopMs: number;
}

/**
 * Session Scheduler - Class-based scheduler with parameterized loops.
 * 
 * Architecture:
 * - Fast Loop (30s): Quick tasks - process due schedules, mark completed sessions
 * - Main Loop (10min): Heavy tasks - session seeding, notification events
 * 
 * This separation optimizes performance by not running expensive queries
 * on every tick while still maintaining responsive session lifecycle management.
 */
export class SessionScheduler {
    private fastLoopTimer: NodeJS.Timeout | null = null;
    private mainLoopTimer: NodeJS.Timeout | null = null;
    private readonly config: SchedulerConfig;

    constructor(config: SchedulerConfig = { fastLoopMs: FAST_LOOP_INTERVAL_MS, mainLoopMs: MAIN_LOOP_INTERVAL_MS }) {
        this.config = config;
    }

    /**
     * Starts the scheduler with both fast and main loops.
     */
    start(): void {
        logger.info(`Starting scheduler with fast loop (${this.config.fastLoopMs}ms) and main loop (${this.config.mainLoopMs}ms)`, 'scheduler');

        // Run initial seeding
        this.seedDefaultSchedulesIfEmpty().catch(err => {
            logger.error('Initial seeding failed', 'scheduler', err instanceof Error ? err : new Error(String(err)));
        });

        // Start fast loop (30s) - handles quick tasks
        this.fastLoopTimer = setInterval(() => this.runFastLoop(), this.config.fastLoopMs);

        // Start main loop (10min) - handles heavy tasks
        this.mainLoopTimer = setInterval(() => this.runMainLoop(), this.config.mainLoopMs);
    }

    /**
     * Stops all scheduler loops.
     */
    stop(): void {
        if (this.fastLoopTimer) {
            clearInterval(this.fastLoopTimer);
            this.fastLoopTimer = null;
        }
        if (this.mainLoopTimer) {
            clearInterval(this.mainLoopTimer);
            this.mainLoopTimer = null;
        }
        logger.info('Scheduler stopped', 'scheduler');
    }

    /**
     * Fast loop - runs every 30 seconds.
     * Handles: processing due schedules, marking completed sessions.
     */
    private async runFastLoop(): Promise<void> {
        try {
            const now = Date.now();
            const nowDate = new Date(now);

            // Get cursor to ensure idempotency
            const lastProcessedStr = await storage.getSystemSetting(CURSOR_KEY);
            if (!lastProcessedStr) {
                await storage.setSystemSetting(CURSOR_KEY, now.toString());
                return;
            }

            const lastProcessed = parseInt(lastProcessedStr, 10);
            if (now <= lastProcessed) return;

            // Process due schedules (create sessions for schedules whose nextRunAt has passed)
            await this.processDueSchedules();

            // Transition finished sessions to 'completed' status
            await this.processCompletedSessions(nowDate);

            // Update cursor
            await storage.setSystemSetting(CURSOR_KEY, now.toString());

        } catch (err) {
            logger.error('Error in fast loop', 'scheduler', err instanceof Error ? err : new Error(String(err)));
        }
    }

    /**
     * Main loop - runs every 10 minutes.
     * Handles: session seeding, notification events.
     */
    private async runMainLoop(): Promise<void> {
        try {
            const now = Date.now();
            const nowDate = new Date(now);

            // Ensure sessions exist within the 7-day lookahead window
            await this.ensureSessionsExistWithinLookahead();

            // Process notification events (push warnings, weekly briefings)
            // Only run this in main loop to avoid loading all sessions every 30s
            const lastProcessedStr = await storage.getSystemSetting(CURSOR_KEY);
            const lastProcessed = lastProcessedStr ? parseInt(lastProcessedStr, 10) : now - this.config.mainLoopMs;
            
            // Look for events in the window from last main loop run to now
            const events = await this.getEventsInWindow(lastProcessed, now);

            for (const event of events) {
                await this.processEvent(event, now);
            }

            logger.debug('Main loop completed', 'scheduler');

        } catch (err) {
            logger.error('Error in main loop', 'scheduler', err instanceof Error ? err : new Error(String(err)));
        }
    }

    /**
     * Processes all schedules whose nextRunAt timestamp has passed.
     */
    private async processDueSchedules(): Promise<void> {
        const now = new Date();
        const dueSchedules = await storage.getDueSchedules(now);

        if (dueSchedules.length > 0) {
            logger.info(`[Scheduler] Found ${dueSchedules.length} due schedule(s) to process`, 'scheduler');
        }

        for (const schedule of dueSchedules) {
            try {
                const { start, end } = computeNextWindow(schedule);
                logger.info(`[Scheduler] Processing schedule ${schedule.id}, next window: ${start.toISOString()} - ${end.toISOString()} (tz: ${schedule.timezone})`, 'scheduler');

                const channel = await storage.getChannel(schedule.channelId);
                const nextSessionNumber = (schedule.sessionCount ?? 0) + 1;

                const title = buildSessionTitle(schedule, nextSessionNumber, start, channel);

                const config = schedule.titleConfig as TitleConfig | null;
                const seasonSize = config?.seasonSize ?? 30;
                const seasonNumber = Math.floor((nextSessionNumber - 1) / seasonSize) + 1;
                const episodeNumber = ((nextSessionNumber - 1) % seasonSize) + 1;

                logger.info(`[Scheduler] Creating session "${title}" at ${start.toISOString()} (tz: ${schedule.timezone})`, 'scheduler');
                const session = await storage.createSessionWithScheduleUpdate({
                    channelId: schedule.channelId,
                    scheduleId: schedule.id,
                    title,
                    description: channel?.description || "Upcoming Session",
                    scheduledStart: start,
                    scheduledEnd: end,
                    timezone: schedule.timezone,
                    sessionNumber: nextSessionNumber,
                    seasonNumber,
                    episodeNumber,
                    subtitle: config?.subtitle,
                }, schedule.id);

                const nextRun = computeNextRunAt(schedule);
                await storage.updateScheduleNextRunAt(schedule.id, nextRun);

                logger.info(`Spawned session "${title}" (S${seasonNumber} E${episodeNumber}) from schedule ${schedule.id}`, 'scheduler');
            } catch (err) {
                logger.error(`Failed to process schedule ${schedule.id}`, 'scheduler', err instanceof Error ? err : new Error(String(err)));
            }
        }
    }

    /**
     * Identifies sessions that have passed their end time and marks them as completed.
     */
    private async processCompletedSessions(now: Date): Promise<void> {
        try {
            const expiredSessions = await storage.getExpiredActiveSessions(now);

            for (const session of expiredSessions) {
                await storage.updateSessionStatus(session.id, 'completed');
                logger.info(`Session ${session.id} ("${session.title}") marked as completed.`, 'scheduler');
            }
        } catch (err) {
            logger.error('Failed to process completed sessions', 'scheduler', err);
        }
    }

    /**
     * Ensures all enabled schedules have sessions scheduled within the lookahead window.
     */
    private async ensureSessionsExistWithinLookahead(): Promise<void> {
        const enabledSchedules = await storage.listSchedules({ onlyEnabled: true });

        for (const schedule of enabledSchedules) {
            try {
                logger.debug(`[Seeding] Analyzing lookahead gaps for scheduleId: ${schedule.id}`, 'scheduler');

                const now = new Date();
                const lookaheadEndBoundary = new Date(now.getTime() + SESSION_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

                const allChannelSessionsWithinWindow = await storage.getSessionsInWindow(schedule.channelId, now, lookaheadEndBoundary, undefined);
                const scheduledDates = getScheduledDatesInWindow(schedule, now, lookaheadEndBoundary);

                const timestampsExistingSessions = new Set(
                    allChannelSessionsWithinWindow.map(s => new Date(s.scheduledStart).getTime())
                );

                const exactDatesNonScheduled = scheduledDates.filter(targetDate => {
                    const isTimeslotFilled = allChannelSessionsWithinWindow.some(existingSession => {
                        const timeDiffMs = Math.abs(new Date(existingSession.scheduledStart).getTime() - targetDate.getTime());
                        const twelveHoursMs = 12 * 60 * 60 * 1000;
                        return timeDiffMs < twelveHoursMs;
                    });

                    if (isTimeslotFilled) {
                        logger.debug(`[Seeding] Validated timeslot is already populated near: ${targetDate.toISOString()}`, 'scheduler');
                    }
                    return !isTimeslotFilled;
                });

                if (exactDatesNonScheduled.length === 0) continue;

                const channelData = await storage.getChannel(schedule.channelId);
                const durationMinutesTarget = (schedule as unknown as { durationMinutes?: number; }).durationMinutes ?? 25;

                for (const exactScheduledStartTimestamp of exactDatesNonScheduled) {
                    const exactScheduledEndTimestamp = new Date(exactScheduledStartTimestamp.getTime() + durationMinutesTarget * 60 * 1000);

                    const nextSessionNumber = (schedule.sessionCount ?? 0) + 1;
                    const title = buildSessionTitle(schedule, nextSessionNumber, exactScheduledStartTimestamp);
                    const config = schedule.titleConfig as TitleConfig | null;

                    const seasonSize = config?.seasonSize ?? 30;
                    const seasonNumber = Math.floor((nextSessionNumber - 1) / seasonSize) + 1;
                    const episodeNumber = ((nextSessionNumber - 1) % seasonSize) + 1;

                    logger.info(`[Seeding] Creating session "${title}" at ${exactScheduledStartTimestamp.toISOString()} (tz: ${schedule.timezone}) for schedule ${schedule.id}`, 'scheduler');
                    await storage.createSessionWithScheduleUpdate({
                        channelId: schedule.channelId,
                        scheduleId: schedule.id,
                        title,
                        description: channelData?.description || 'Upcoming session',
                        scheduledStart: exactScheduledStartTimestamp,
                        scheduledEnd: exactScheduledEndTimestamp,
                        timezone: schedule.timezone,
                        sessionNumber: nextSessionNumber,
                        seasonNumber,
                        episodeNumber,
                        subtitle: config?.subtitle,
                    }, schedule.id);

                    await storage.updateScheduleNextRunAt(schedule.id, computeNextRunAt(schedule));

                    logger.info(`[Seeding] Resolved gap. Spawned session "${title}" at ${exactScheduledStartTimestamp.toISOString()} for schedule ${schedule.id}`, 'scheduler');
                }
            } catch (err) {
                logger.error(`[Seeding] Uncaught error ensuring sessions for schedule ${schedule.id}`, 'scheduler', err instanceof Error ? err : new Error(String(err)));
            }
        }
    }

    /**
     * Retrieves all notification events that should be processed within a time window.
     * Optimized to only query sessions starting in the next 10 minutes instead of all sessions.
     */
    private async getEventsInWindow(start: number, end: number): Promise<ScheduledEvent[]> {
        const events: ScheduledEvent[] = [];

        // Session 5-minute warnings - optimized query
        // Only fetch sessions starting in the next 10 minutes instead of ALL scheduled sessions
        const now = new Date(start);
        const windowEnd = new Date(end);
        
        // Get sessions starting in the window (optimized - only relevant sessions)
        const upcomingSessions = await storage.getGlobalSessionsInWindow(
            now,
            windowEnd,
            'scheduled'
        );

        for (const session of upcomingSessions) {
            const sessionStart = new Date(session.scheduledStart).getTime();
            const warningTime = sessionStart - 5 * 60 * 1000;

            // Only add if warning time falls within our window
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

        return events;
    }

    /**
     * Processes a single scheduled event.
     */
    private async processEvent(event: ScheduledEvent, now: number): Promise<void> {
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
        if (existing && (existing.status === 'sent' || existing.status === 'failed')) {
            return;
        }

        try {
            if (event.type === 'SESSION_WARNING_5MIN') {
                await sendPushWarningsForSession(event.payload as Session);
            } else if (event.type === 'WEEKLY_BRIEF') {
                await checkAndSendWeeklyBriefing();
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
     */
    private async seedDefaultSchedulesIfEmpty(): Promise<void> {
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

                logger.info(`Creating default schedule for channel ${channel.channelId} at ${hour}:00 America/Denver`, 'scheduler');
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
}

// Export a singleton instance for backward compatibility
export const scheduler = new SessionScheduler();

/**
 * Starts the recurring scheduler (backward compatibility wrapper).
 * 
 * Initializes the scheduler loops and performs initial seeding of schedules if none exist.
 * This function should be called once at server startup.
 */
export function startRecurringScheduler(): void {
    scheduler.start();
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
            const candidate = createZonedDate(current, schedule.timezone, hours, minutes);
            if (candidate >= start && candidate <= end) {
                dates.push(candidate);
            }
            current.setDate(current.getDate() + 1);
        }
        return dates;
    }

    const dates: Date[] = [];
    const current = new Date(start);
    current.setHours(0, 0, 0, 0);

    while (current <= end) {
        const targetDaysList = scheduledDays.map(d => d.toLowerCase());
        const currentZonedDayName = formatInTZ(current, schedule.timezone, 'EEEE').toLowerCase();

        if (targetDaysList.includes(currentZonedDayName)) {
            const candidate = createZonedDate(current, schedule.timezone, hours, minutes);
            if (candidate >= start && candidate <= end) {
                dates.push(candidate);
            }
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
            const dateStr = getDateStringInTZ(scheduledStart, schedule.timezone);
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
    const [ hours, minutes ] = (schedule.scheduledTime || '19:00').split(':').map(Number);
    const durationMinutesTarget = (schedule as unknown as { durationMinutes?: number; }).durationMinutes ?? 25;
    const durationMs = durationMinutesTarget * 60 * 1000;

    // Establish the absolute start boundary for the target day
    let computedStartBoundary = createZonedDate(targetDate, schedule.timezone, hours, minutes);

    if (schedule.scheduledDays && schedule.scheduledDays.length > 0) {
        const days = schedule.scheduledDays as string[];

        // If the calculated boundary is in the past, we must force a skip to the next day
        const isTargetInPast = computedStartBoundary <= targetDate;
        const nextValidDay = getNextScheduledDay(targetDate, days, !isTargetInPast, schedule.timezone);

        if (nextValidDay) {
            computedStartBoundary = createZonedDate(nextValidDay, schedule.timezone, hours, minutes);
        }
    } else if (computedStartBoundary <= targetDate) {
        // Daily fallback: push approx 24h, but we MUST re-zone to handle DST correctly
        const nextDayApprox = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
        computedStartBoundary = createZonedDate(nextDayApprox, schedule.timezone, hours, minutes);

        if (computedStartBoundary <= targetDate) {
            const nextNextDayApprox = new Date(nextDayApprox.getTime() + 24 * 60 * 60 * 1000);
            computedStartBoundary = createZonedDate(nextNextDayApprox, schedule.timezone, hours, minutes);
        }
    }

    const computedEndBoundary = new Date(computedStartBoundary.getTime() + durationMs);
    return { start: computedStartBoundary, end: computedEndBoundary };
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
function getNextScheduledDay(from: Date, days: string[], includeTodayIfValid: boolean = false, timezone: string = 'UTC'): Date | null {
    if (!days.length) return null;

    const dayMap: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
        thursday: 4, friday: 5, saturday: 6
    };

    const targetDays = days.map(d => dayMap[ d.toLowerCase() ]).filter(d => d !== undefined);
    if (!targetDays.length) return null;

    // Use timezone-aware formatting to determine the actual day of the week in the target timezone
    // 'i' returns 1 (Monday) - 7 (Sunday), we map it to 0-6 where 0 = Sunday
    const currentZonedISODay = parseInt(formatInTZ(from, timezone, 'i'), 10);
    const currentDay = currentZonedISODay === 7 ? 0 : currentZonedISODay;
    const startIndex = includeTodayIfValid ? 0 : 1;

    for (let i = startIndex; i <= 7; i++) {
        const checkDay = (currentDay + i) % 7;
        if (targetDays.includes(checkDay)) {
            // We only need the date portion string to be accurate in the target timezone
            // createZonedDate will correctly apply the scheduled hours/minutes later
            const result = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
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
    const { start } = computeNextWindowForDate(schedule, now);
    return start;
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

    const now = new Date(start);
    const windowEnd = new Date(end);
    const upcomingSessions = await storage.getGlobalSessionsInWindow(now, windowEnd, 'scheduled');

    for (const session of upcomingSessions) {
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
    const afterDate = new Date(after);
    
    // Target timezone is always Mountain Time
    const targetTz = 'America/Denver';
    const afterDateStr = formatInTZ(afterDate, targetTz, 'yyyy-MM-dd');
    let target = createZonedDate(afterDateStr, targetTz, 15, 0);

    const currentZonedISODay = parseInt(formatInTZ(target, targetTz, 'i'), 10);
    const currentDay = currentZonedISODay === 7 ? 0 : currentZonedISODay;
    
    // Monday = 1
    const diff = 1 - currentDay;
    target = new Date(target.getTime() + diff * 24 * 60 * 60 * 1000);

    if (target.getTime() <= after) {
        target = new Date(target.getTime() + 7 * 24 * 60 * 60 * 1000);
    }
    
    // Re-zone the final date to catch any DST boundaries crossed
    const finalDateStr = formatInTZ(target, targetTz, 'yyyy-MM-dd');
    return createZonedDate(finalDateStr, targetTz, 15, 0).getTime();
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
            await checkAndSendWeeklyBriefing();
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

            logger.info(`Creating default schedule for channel ${channel.channelId} at ${hour}:00 America/Denver`, 'scheduler');
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

export async function checkAndSendWeeklyBriefing(): Promise<void> {
    const now = new Date();
    const targetTz = 'America/Denver';

    // Check Day/Time (Monday 3:00 PM MST) strictly within the target timezone
    const currentZonedISODay = parseInt(formatInTZ(now, targetTz, 'i'), 10);
    const isMonday = currentZonedISODay === 1;
    
    const hours = parseInt(formatInTZ(now, targetTz, 'HH'), 10);
    const minutes = parseInt(formatInTZ(now, targetTz, 'mm'), 10);
    const isThreePM = hours === 15 && minutes === 0;

    if (isMonday && isThreePM) {
        // Evaluate the week key using the target timezone's interpretation of "now"
        const zonedNowStr = formatInTZ(now, targetTz, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx");
        const zonedNow = new Date(zonedNowStr);
        const weekKey = `${getYear(zonedNow)}-${getISOWeek(zonedNow)}`;

        const needsSending = await storage.shouldSendWeeklyBriefing(weekKey);
        if (!needsSending) return;

        logger.info(`Executing weekly briefing for week ${weekKey}`, 'scheduler');
        await dispatchWeeklyBriefing();
        await storage.markWeeklyBriefingSent(weekKey);
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
        .map(s => `- ${s.title}: ${formatInTZ(s.scheduledStart, s.timezone, "EEEE, MMMM do 'at' h:mm a")} ${s.timezone}`)
        .join('\n');

    const subject = "Your Weekly 25th Chapter Schedule";
    const body = `Hello reader,\n\nHere is your story schedule for the upcoming week:\n\n${scheduleList}\n\nJoin the global circle for your daily 25.\n\n- The 25th Chapter Team`;

    // Render HTML template for the weekly briefing
    const htmlBody = await render(
        TemplateWeeklyBriefingEmail({
            sessions: upcoming.map(s => ({
                id: s.id,
                title: s.title,
                description: s.description || "",
                formattedDate: formatInTZ(s.scheduledStart, s.timezone, "EEEE, MMMM do 'at' h:mm a"),
            })),
            urlAppBase: process.env.APP_URL || 'https://25thchapter.com',
        })
    );

    for (const user of users) {
        if (user.email) {
            await sendEmail(user.email, subject, body, htmlBody);
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
    const lastProcessedStr = await storage.getSystemSetting(CURSOR_KEY);
    const lastProcessed = lastProcessedStr ? new Date(lastProcessedStr) : new Date(now.getTime() - 5 * 60 * 1000);

    const lookahead = new Date(now.getTime() + 5 * 60 * 1000);
    const startingSoon = await storage.getGlobalSessionsInWindow(lastProcessed, lookahead, 'scheduled');

    for (const session of startingSoon) {
        const start = new Date(session.scheduledStart).getTime();
        if (start - now.getTime() <= 5 * 60 * 1000) {
            await sendPushWarningsForSession(session);
        }
    }

    await storage.setSystemSetting(CURSOR_KEY, lookahead.toISOString());
}

// DEPRECATED: Export for backwards compatibility
// Use seedDefaultSchedulesIfEmpty() instead
export const seedDailySchedules = seedDefaultSchedulesIfEmpty;

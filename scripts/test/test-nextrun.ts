import { computeNextRunAt } from '../../server/sessions/scheduler';
import { Schedule } from '@shared/schema';

// Test if there are schedule configurations that gets computeNextRunAt stuck!

const schedule = {
    id: 1,
    channelId: 'channel-1',
    scheduledDays: [ 'wednesday' ],
    scheduledTime: '20:17',
    intervalEnabled: true,
    timezone: 'America/New_York',
    sessionCount: 0,
    createdAt: new Date(),
    nextRunAt: new Date(),
    titleConfig: null
} as Schedule;

const targetDate = new Date('2026-04-03T20:17:11-04:00'); // Friday 20:17:11 EDT

console.log("Next run is:", computeNextRunAt(schedule));

import { createZonedDate, getDateStringInTZ } from './shared/date';

function getNextScheduledDay(from: Date, days: string[], includeTodayIfValid: boolean = false): Date | null {
    if (!days.length) return null;

    const dayMap: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
        thursday: 4, friday: 5, saturday: 6
    };

    const targetDays = days.map(d => dayMap[ d.toLowerCase() ]).filter(d => d !== undefined);
    if (!targetDays.length) return null;

    const currentDay = from.getDay();
    const startIndex = includeTodayIfValid ? 0 : 1;

    for (let i = startIndex; i <= 7; i++) {
        const checkDay = (currentDay + i) % 7;
        if (targetDays.includes(checkDay)) {
            const result = new Date(from.getTime());
            result.setDate(from.getDate() + i);
            result.setHours(0, 0, 0, 0);
            return result;
        }
    }
    return null;
}

function computeNextWindowForDate(scheduledTime: string, timezone: string, scheduledDays: string[], targetDate: Date) {
    const [ hours, minutes ] = scheduledTime.split(':').map(Number);
    let computedStartBoundary = createZonedDate(targetDate, timezone, hours, minutes);

    if (scheduledDays.length > 0) {
        const isTargetInPast = computedStartBoundary <= targetDate;
        const nextValidDay = getNextScheduledDay(targetDate, scheduledDays, !isTargetInPast);
        
        if (nextValidDay) {
            computedStartBoundary = createZonedDate(nextValidDay, timezone, hours, minutes);
        }
    }
    return computedStartBoundary;
}

// targetDate is 05:00 UTC Sat (01:00 NYC Sat)
const targetDate = new Date('2026-04-04T05:00:00.000Z'); 
// The schedule wants 00:00 NYC time (midnight in NY)
// 00:00 NYC Sat is 04:00 UTC Sat.
// 04:00 UTC is <= 05:00 UTC. So it should go to the next day.
const nextRun = computeNextWindowForDate('00:00', 'America/New_York', ['saturday'], targetDate);

console.log("TargetDate:", targetDate.toISOString());
console.log("NextRun:", nextRun.toISOString());
console.log("Is stuck?", nextRun <= targetDate);

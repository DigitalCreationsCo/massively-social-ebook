import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { addDays } from 'date-fns';

export { getISOWeek, getYear } from 'date-fns';

// Removed global TIMEZONE constant to prevent accidental hardcoding

export function getDateStringInTZ(date: Date | number | string, tz: string): string {
    return formatInTimeZone(date, tz, 'yyyy-MM-dd');
}

export function formatInTZ(date: Date | number | string, tz: string, formatStr: string): string {
    return formatInTimeZone(date, tz, formatStr);
}

export function isTodayInTZ(date: Date | number | string, tz: string): boolean {
    const dateStr = getDateStringInTZ(date, tz);
    const nowStr = getDateStringInTZ(new Date(), tz);
    return dateStr === nowStr;
}

export function isTomorrowInTZ(date: Date | number | string, tz: string): boolean {
    const targetDateStr = getDateStringInTZ(date, tz);

    const [y, m, d] = getDateStringInTZ(new Date(), tz).split('-').map(Number);
    const tomorrow = new Date(y, m - 1, d + 1);
    
    const ty = tomorrow.getFullYear();
    const tm = tomorrow.getMonth() + 1;
    const td = tomorrow.getDate();
    const tomorrowStr = `${ty}-${tm.toString().padStart(2, '0')}-${td.toString().padStart(2, '0')}`;

    return targetDateStr === tomorrowStr;
}

/**
 * Creates a Date object from a specific time in a specific timezone
 */
export function createZonedDate(date: Date | number | string, tz: string, hour: number, minute: number = 0): Date {
    const datePart = getDateStringInTZ(date, tz);
    const timePart = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`;
    return fromZonedTime(`${datePart} ${timePart}`, tz);
}
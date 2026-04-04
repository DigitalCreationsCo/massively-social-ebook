import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

export { getISOWeek, getYear } from 'date-fns';
export { formatInTimeZone, fromZonedTime, toZonedTime };

// Common timezone options for UI dropdowns
export const TIMEZONE_OPTIONS = [
    { value: 'America/New_York', label: 'Eastern Time (ET)' },
    { value: 'America/Chicago', label: 'Central Time (CT)' },
    { value: 'America/Denver', label: 'Mountain Time (MT)' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
    { value: 'America/Phoenix', label: 'Arizona (MST)' },
    { value: 'America/Anchorage', label: 'Alaska (AKT)' },
    { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
    { value: 'UTC', label: 'UTC' },
    { value: 'Europe/London', label: 'London (GMT/BST)' },
    { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
    { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
    { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
    { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
    { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
    { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
] as const;

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

/**
 * Converts a Date object to a specific timezone, returning a new Date representing
 * that moment in the target timezone
 */
export function toTimezone(date: Date, tz: string): Date {
    return toZonedTime(date, tz);
}

/**
 * Converts a datetime-local input value (YYYY-MM-DDTHH:mm) in a specific timezone
 * to a UTC Date object for storage
 */
export function datetimeLocalToUTC(datetimeLocal: string, tz: string): Date {
    return fromZonedTime(datetimeLocal, tz);
}

/**
 * Converts a UTC Date to a datetime-local string (YYYY-MM-DDTHH:mm) in the specified timezone
 */
export function utcToDatetimeLocal(utcDate: Date, tz: string): string {
    return formatInTimeZone(utcDate, tz, "yyyy-MM-dd'T'HH:mm");
}

/**
 * Formats a date for display in a specific timezone using a human-readable format
 */
export function formatDisplayDate(date: Date | string | number | null | undefined, tz: string): string {
    if (!date) return '—'
    try {
        return formatInTimeZone(date, tz, "EEE, MMM d, yyyy 'at' h:mm a zzz");
    } catch {
        return '—';
    }
}

/**
 * Formats a date for display in a specific timezone using ISO-like format
 */
export function formatRelativeDate(date: Date | string | number | null | undefined, tz: string): string {
    if (!date) return '—'
    try {
        const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
        return formatInTimeZone(d, tz, "MMM d, h:mm a zzz");
    } catch {
        return '—';
    }
}
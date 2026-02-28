import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const TIMEZONE = 'America/Denver';

export function getMSTDateString(date: Date | number | string): string {
    return formatInTimeZone(date, TIMEZONE, 'yyyy-MM-dd');
}

export function formatMST(date: Date | number | string, formatStr: string): string {
    return formatInTimeZone(date, TIMEZONE, formatStr);
}

export function isTodayMST(date: Date | number | string): boolean {
    const dateStr = getMSTDateString(date);
    const nowStr = getMSTDateString(new Date());
    return dateStr === nowStr;
}

export function isTomorrowMST(date: Date | number | string): boolean {
    const dateStr = getMSTDateString(date);
    
    const [y, m, d] = getMSTDateString(new Date()).split('-').map(Number);
    const tomorrow = new Date(y, m - 1, d + 1);
    
    const ty = tomorrow.getFullYear();
    const tm = tomorrow.getMonth() + 1;
    const td = tomorrow.getDate();
    const tomorrowStr = `${ty}-${tm.toString().padStart(2, '0')}-${td.toString().padStart(2, '0')}`;
    
    return dateStr === tomorrowStr;
}



export function createMSTDate(date: Date | number | string, hour: number, minute: number = 0, second: number = 0): Date {
    const mstStr = getMSTDateString(date);
    const localStr = `${mstStr}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`;
    return fromZonedTime(localStr, TIMEZONE);
}

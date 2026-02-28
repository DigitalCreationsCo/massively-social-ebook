const { formatInTimeZone } = require('date-fns-tz');

const TIMEZONE = 'America/Denver';

function getMSTDateString(date) {
    return formatInTimeZone(date, TIMEZONE, 'yyyy-MM-dd');
}

function isTodayMST(date) {
    const dateStr = getMSTDateString(date);
    const nowStr = getMSTDateString(new Date());
    return dateStr === nowStr;
}

function isTomorrowMST(date) {
    const dateStr = getMSTDateString(date);
    const [y, m, d] = getMSTDateString(new Date()).split('-').map(Number);
    const tomorrow = new Date(y, m - 1, d + 1);
    
    const [ty, tm, td] = [tomorrow.getFullYear(), tomorrow.getMonth() + 1, tomorrow.getDate()];
    const tomorrowStr = `${ty}-${tm.toString().padStart(2, '0')}-${td.toString().padStart(2, '0')}`;
    
    return dateStr === tomorrowStr;
}

console.log('Now:', new Date());
console.log('MST today:', getMSTDateString(new Date()));
console.log('isToday:', isTodayMST(new Date()));

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
console.log('isTomorrow:', isTomorrowMST(tomorrow));


const { fromZonedTime, formatInTimeZone } = require('date-fns-tz');

const TIMEZONE = 'America/Denver';
const localStr = "2026-02-27T19:00:00";
const date = fromZonedTime(localStr, TIMEZONE);

console.log(date.toISOString());
console.log(formatInTimeZone(date, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"));

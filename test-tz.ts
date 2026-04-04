import { createZonedDate, getDateStringInTZ } from './shared/date';
import { ensureSessionsExistWithinLookahead } from './server/sessions/scheduler';

console.log('Testing createZonedDate logic...');

function testZonedDate() {
    const tz = 'America/New_York';
    let current = new Date();
    current.setHours(0,0,0,0);
    console.log("Local midnight:", current.toISOString());
    console.log("Date string in tz:", getDateStringInTZ(current, tz));
}
testZonedDate();

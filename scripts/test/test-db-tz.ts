import { db } from '../../server/db';
import { sessions } from '@shared/schema';
import { desc } from 'drizzle-orm';

async function verifyDBPrecision() {
    const recent = await db.select().from(sessions).orderBy(desc(sessions.id)).limit(1);
    if (recent.length > 0) {
        console.log("DB scheduledStart:", recent[ 0 ].scheduledStart);
        console.log("Type:", typeof recent[ 0 ].scheduledStart);
        if (recent[ 0 ].scheduledStart instanceof Date) {
            console.log("is Date:", true);
            console.log("getTime:", recent[ 0 ].scheduledStart.getTime());
            console.log("ISO:", recent[ 0 ].scheduledStart.toISOString());
        } else if (typeof recent[ 0 ].scheduledStart === 'string') {
            console.log("is String:", true);
            console.log("String val:", recent[ 0 ].scheduledStart);
            console.log("getTime directly:", (new Date(recent[ 0 ].scheduledStart)).getTime());
        }
    }
}

verifyDBPrecision().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});

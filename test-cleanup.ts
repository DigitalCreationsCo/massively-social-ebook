import { db } from './server/db';
import { sessions } from '@shared/schema';
import { eq, inArray, sql } from 'drizzle-orm';

async function purgeDuplicates() {
    console.log("Identifying duplicate sessions...");
    
    // We can use a raw SQL CTE to find rows to delete, or fetch and process in memory.
    // Given there might be thousands, in-memory processing is easy and safe.
    
    // Fetch all sessions (id, channelId, scheduledStart)
    const allSessions = await db.select({
        id: sessions.id,
        channelId: sessions.channelId,
        scheduledStart: sessions.scheduledStart
    }).from(sessions);

    console.log(`Total sessions found: ${allSessions.length}`);

    const seen = new Set<string>();
    const idsToDelete: number[] = [];

    for (const session of allSessions) {
        const timeKey = session.scheduledStart instanceof Date 
            ? session.scheduledStart.getTime() 
            : new Date(session.scheduledStart as string).getTime();
            
        const uniqueKey = `${session.channelId}_${timeKey}`;

        if (seen.has(uniqueKey)) {
            idsToDelete.push(session.id);
        } else {
            seen.add(uniqueKey);
        }
    }

    console.log(`Found ${idsToDelete.length} duplicates to delete.`);

    if (idsToDelete.length > 0) {
        // Delete in chunks to avoid query param limits
        const chunkSize = 1000;
        for (let i = 0; i < idsToDelete.length; i += chunkSize) {
            const chunk = idsToDelete.slice(i, i + chunkSize);
            console.log(`Deleting chunk ${i/chunkSize + 1} of ${Math.ceil(idsToDelete.length/chunkSize)}...`);
            await db.delete(sessions).where(inArray(sessions.id, chunk));
        }
        console.log("Deletion complete.");
    } else {
        console.log("No duplicates found to delete.");
    }
}

purgeDuplicates().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});

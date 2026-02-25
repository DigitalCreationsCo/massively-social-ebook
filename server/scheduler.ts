import cron from 'node-cron';
import { storage } from './storage';
import { CHANNELS, type Channel } from '@shared/channels';

/**
 * Automatically schedules daily sessions for all channels.
 * Sessions are scheduled to start at 19:00 (7 PM) and 20:00 (8 PM) local time (server time).
 * Each session lasts 25 minutes.
 */
export function startRecurringScheduler() {
    console.log('[Scheduler] Initializing recurring session scheduler...');

    // Run every day at 00:01
    cron.schedule('1 0 * * *', async () => {
        console.log('[Scheduler] Running daily session seeding...');
        await seedDailySessions();
    });

    // Also run on startup to ensure we have sessions for today
    seedDailySessions().catch(err => {
        console.error('[Scheduler] Initial seeding failed:', err);
    });
}

async function seedDailySessions() {
    const now = new Date();
    
    for (const channelId of CHANNELS) {
        // Check if we already have sessions scheduled for today
        const existing = await storage.listSessions(channelId, 'scheduled');
        const todaySessions = existing.filter(s => {
            const start = new Date(s.scheduledStart);
            return start.getFullYear() === now.getFullYear() &&
                   start.getMonth() === now.getMonth() &&
                   start.getDate() === now.getDate();
        });

        if (todaySessions.length === 0) {
            console.log(`[Scheduler] Seeding sessions for ${channelId} for ${now.toDateString()}`);
            
            // Schedule one session for tonight
            // Sci-fi at 19:00, Mystery at 20:00
            const hour = channelId === 'scifi' ? 19 : 20;
            const start = new Date(now);
            start.setHours(hour, 0, 0, 0);
            
            const end = new Date(start.getTime() + 25 * 60 * 1000); // 25 minutes later

            const title = channelId === 'scifi' 
                ? `Galactic Horizon: Entry ${now.getDate()}`
                : `Midnight Alibi: Case ${now.getDate()}`;
            
            const description = channelId === 'scifi'
                ? "The journey across the stars continues. What awaits the crew in the deep void?"
                : "A new mystery unfolds in the heart of the foggy city. Can you spot the clues?";

            try {
                await storage.createSession({
                    channelId,
                    title,
                    description,
                    scheduledStart: start,
                    scheduledEnd: end
                });
                console.log(`[Scheduler] Created session: ${title} at ${start.toLocaleTimeString()}`);
            } catch (err) {
                console.error(`[Scheduler] Failed to create session for ${channelId}:`, err);
            }
        } else {
            console.log(`[Scheduler] Sessions already exist for ${channelId} today.`);
        }
    }
}

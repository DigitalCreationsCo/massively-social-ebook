import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local', override: true });

import pg from 'pg';

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  console.log('Finding duplicates...');
  const res = await pool.query(`
    SELECT channel_id, scheduled_start, COUNT(*)
    FROM sessions
    GROUP BY channel_id, scheduled_start
    HAVING COUNT(*) > 1
  `);
  
  console.log('Duplicates:', res.rows);

  for (const row of res.rows) {
    console.log(`Fixing duplicate for ${row.channel_id} at ${row.scheduled_start}`);
    // Keep one, delete others
    await pool.query(`
      DELETE FROM sessions 
      WHERE id IN (
        SELECT id FROM sessions 
        WHERE channel_id = $1 AND scheduled_start = $2
        ORDER BY id DESC
        OFFSET 1
      )
    `, [row.channel_id, row.scheduled_start]);
  }
  
  console.log('Done cleaning duplicates.');
  await pool.end();
}

main().catch(console.error);
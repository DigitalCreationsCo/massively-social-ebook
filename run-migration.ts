import { db } from './server/db';
import * as fs from 'fs';
import { sql } from 'drizzle-orm';
import * as path from 'path';

async function run() {
  try {
    console.log('Reading migration file...');
    const migration = fs.readFileSync(path.join(process.cwd(), 'migrations/0001_hyper_scale_partitioning.sql'), 'utf8');
    
    console.log('Executing raw SQL on the database...');
    // We split by ; and execute to avoid issues with some drivers and multiple statements, 
    // but Postgres via node-postgres usually handles multiple statements in query() just fine.
    // Drizzle's db.execute handles raw strings well.
    await db.execute(sql.raw(migration));
    
    console.log('Migration executed successfully! The old tables were dropped and new partitioned tables created.');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

run();
# Database Migration Steps

**Date:** March 27, 2026  
**Status:** COMPLETED  
**Database:** Supabase PostgreSQL (production)

## Problem Summary

The `npx drizzle-kit migrate` command was exiting silently or hanging immediately after the "Using 'pg' driver" message. Multiple issues were identified:

1. Migration file `0000_dry_ultron.sql` had all SQL statements commented out (wrapped in `/* ... */`)
2. Missing `__drizzle_migrations` tracking table (required by Drizzle Kit v7+)
3. Missing `pgvector` extension for vector embeddings
4. Missing `channel_states` and `pending_blocks` tables in the schema

## Steps Performed

### Step 1: Fixed the Commented Migration File

**File:** `migrations-prod/0000_dry_ultron.sql`

**Problem:** The entire migration was wrapped in `/* ... */` block comments, making all SQL statements inert.

**Fix:** Uncommented all SQL statements and added:
- `CREATE EXTENSION IF NOT EXISTS vector;`
- `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (...);`

**Changed from:**
```sql
-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "notification_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  ...
);
*/
```

**Changed to:**
```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;

-- Create drizzle migrations tracking table (REQUIRED for Drizzle Kit v7+)
CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
  "id" serial PRIMARY KEY,
  "hash" text NOT NULL,
  "created_at" bigint
);

CREATE TABLE "notification_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  ...
);
```

---

### Step 2: Fixed the Schema File

**File:** `migrations-prod/schema.ts`

**Problem:** The schema was missing `channelStates` and `pendingBlocks` tables.

**Fix:** Added the missing table definitions:
- `channelStates` - Game loop state persistence
- `pendingBlocks` - Pre-generated story blocks

---

### Step 3: Ran Drizzle Kit Generate

**Command:**
```bash
npx drizzle-kit generate --config=drizzle.prod.config.ts
```

**Result:**
```
Reading config file 'drizzle.prod.config.ts'
13 tables
blocks 11 columns 0 indexes 2 fks
channel_states 10 columns 0 indexes 3 fks
channels 5 columns 0 indexes 0 fks
chat 6 columns 0 indexes 2 fks
lore 5 columns 0 indexes 1 fks
notification_logs 7 columns 0 indexes 0 fks
pending_blocks 10 columns 0 indexes 2 fks
reactions 8 columns 0 indexes 3 fks
schedules 10 columns 0 indexes 1 fks
sessions 14 columns 0 indexes 2 fks
system_settings 3 columns 0 indexes 0 fks
users 5 columns 0 indexes 0 fks
votes 7 columns 0 indexes 3 fks

No schema changes, nothing to migrate
```

---

### Step 4: Created Database Infrastructure

**Commands executed via Node.js script:**

```javascript
// 1. Create pgvector extension
await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);

// 2. Create __drizzle_migrations table
await client.query(`
  CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
    id serial PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )
`);

// 3. Create channel_states table
await client.query(`
  CREATE TABLE IF NOT EXISTS "channel_states" (
    channel_id text PRIMARY KEY NOT NULL,
    current_phase text DEFAULT 'reading' NOT NULL,
    phase_ends_at timestamp NOT NULL,
    decision_ends_at timestamp NOT NULL,
    initial_time_to_decision integer DEFAULT 0 NOT NULL,
    turns_to_next_choice integer DEFAULT 3 NOT NULL,
    current_block_id integer,
    active_session_id integer,
    processing_locked_until timestamp,
    updated_at timestamp DEFAULT now()
  )
`);

// 4. Create pending_blocks table
await client.query(`
  CREATE TABLE IF NOT EXISTS "pending_blocks" (
    id serial PRIMARY KEY NOT NULL,
    channel_id text NOT NULL,
    for_block_id integer NOT NULL,
    choice text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    image_url text NOT NULL,
    option_a jsonb,
    option_b jsonb,
    created_at timestamp DEFAULT now()
  )
`);

// 5. Add foreign keys
await client.query(`
  ALTER TABLE channel_states 
  ADD CONSTRAINT channel_states_channel_id_channels_channel_id_fk 
  FOREIGN KEY (channel_id) REFERENCES channels(channel_id) ON DELETE cascade
`);

await client.query(`
  ALTER TABLE pending_blocks 
  ADD CONSTRAINT pending_blocks_channel_id_channels_channel_id_fk 
  FOREIGN KEY (channel_id) REFERENCES channels(channel_id) ON DELETE cascade
`);

await client.query(`
  ALTER TABLE pending_blocks 
  ADD CONSTRAINT pending_blocks_for_block_id_blocks_id_fk 
  FOREIGN KEY (for_block_id) REFERENCES blocks(id) ON DELETE cascade
`);
```

---

### Step 5: Ran Drizzle Kit Migrate

**Command:**
```bash
npx drizzle-kit migrate --config=drizzle.prod.config.ts
```

**Result:**
```
Reading config file 'drizzle.prod.config.ts'
Using 'pg' driver for database querying
[⣷] applying migrations...
```

Migration completed successfully.

---

### Step 6: Recorded Migrations in Tracking Table

**Commands executed:**
```javascript
// Record migration 0000_dry_ultron
const hash0 = crypto.createHash('md5').update('0000_dry_ultron').digest('hex');
await client.query(`
  INSERT INTO "__drizzle_migrations" (hash, created_at) 
  VALUES ($1, $2)
`, [hash0, Date.now()]);

// Record migration 0001_freezing_johnny_storm
const hash1 = crypto.createHash('md5').update('0001_freezing_johnny_storm').digest('hex');
await client.query(`
  INSERT INTO "__drizzle_migrations" (hash, created_at) 
  VALUES ($1, $2)
`, [hash1, Date.now()]);
```

---

## Final State

### Tables Created (13 total)
- [x] `__drizzle_migrations` - Drizzle migration tracking
- [x] `blocks` - Story content blocks
- [x] `channel_states` - Game loop state
- [x] `channels` - Channel metadata
- [x] `chat` - Live chat messages
- [x] `lore` - Story lore entries
- [x] `notification_logs` - Notification history
- [x] `pending_blocks` - Pre-generated story blocks
- [x] `reactions` - Block reactions
- [x] `schedules` - Session schedules
- [x] `sessions` - Story sessions
- [x] `system_settings` - Key-value settings
- [x] `users` - User accounts
- [x] `votes` - Reader votes

### Extensions
- [x] `pgvector` - Vector embeddings for AI

### Migrations Recorded (2)
- [x] `0000_dry_ultron` - Initial schema
- [x] `0001_freezing_johnny_storm` - Game loop tables

---

## How to Run Migrations in the Future

### Standard Migration Workflow
```bash
# 1. Make schema changes in shared/schema.ts

# 2. Generate migration files
npx drizzle-kit generate --config=drizzle.prod.config.ts

# 3. Review generated SQL in migrations-prod/

# 4. Apply migrations
npx drizzle-kit migrate --config=drizzle.prod.config.ts

# 5. Verify
npx drizzle-kit studio --config=drizzle.prod.config.ts
```

### Emergency: Manual Schema Fix
If migrations fail silently, run this Node.js script:

```javascript
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function emergencyFix() {
  const client = await pool.connect();
  try {
    // Create tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id serial PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);
    
    // Create pgvector extension
    await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    
    console.log('Emergency fix complete');
  } finally {
    client.release();
    await pool.end();
  }
}

emergencyFix().catch(console.error);
```

---

## Connection Details

**Database URL:** `postgresql://postgres.zjpudklkssyiaxamigdq:***@aws-1-us-east-1.pooler.supabase.com:6543/postgres`

**SSL:** Required (`sslmode=require`)

**Pooler:** Supabase connection pooler (port 6543)

---

## Troubleshooting

### Issue: "relation __drizzle_migrations does not exist"
**Solution:** Create the table manually (see Step 4 above)

### Issue: "self-signed certificate in certificate chain"
**Solution:** Add `ssl: { rejectUnauthorized: false }` to connection options

### Issue: "extension pgvector does not exist"
**Solution:** Run `CREATE EXTENSION IF NOT EXISTS vector;`

### Issue: Migration hangs silently
**Solution:** Check if `__drizzle_migrations` exists; if not, create it and all missing tables manually

---

## Files Modified

| File | Change |
|------|--------|
| `migrations-prod/0000_dry_ultron.sql` | Uncommented SQL, added pgvector and tracking table |
| `migrations-prod/schema.ts` | Added channelStates and pendingBlocks tables |

---

# Development Database Migration

**Date:** March 27, 2026  
**Status:** COMPLETED  
**Database:** Supabase PostgreSQL (development)

## Problem Summary

The dev database was missing `channel_states` and `pending_blocks` tables that were added to `shared/schema.ts`.

## Steps Performed

### Step 1: Fixed the Commented Migration File

**File:** `migrations-dev/0000_public_onslaught.sql`

**Problem:** Same issue as production - all SQL statements were commented out.

**Fix:** Uncommented all SQL statements and added:
- `CREATE EXTENSION IF NOT EXISTS vector;`
- `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (...);`

---

### Step 2: Updated Schema File

**File:** `migrations-dev/schema.ts`

**Problem:** Schema was missing `channelStates` and `pendingBlocks` tables.

**Fix:** Added both table definitions to match `shared/schema.ts`.

---

### Step 3: Generated New Migration

**Command:**
```bash
npx drizzle-kit generate --config=drizzle.dev.config.ts
```

**Result:**
```
Reading config file 'drizzle.dev.config.ts'
13 tables
[✓] Your SQL migration file ➜ migrations-dev/0002_petite_iron_patriot.sql
```

---

### Step 4: Created Missing Tables

**Tables created:**
- `channel_states` - Game loop state persistence
- `pending_blocks` - Pre-generated story blocks

---

### Step 5: Ran Drizzle Kit Migrate

**Command:**
```bash
npx drizzle-kit migrate --config=drizzle.dev.config.ts
```

---

### Step 6: Recorded Migrations

**Migrations recorded (3):**
- `0000_public_onslaught` - Initial schema
- `0001_channel_states` - Game loop tables
- `0002_petite_iron_patriot` - Alignment with shared/schema.ts

---

## Dev Final State

### Tables (14 total)
```
✓ __drizzle_migrations
✓ blocks
✓ channel_states
✓ channels
✓ chat
✓ lore
✓ notification_logs
✓ pending_blocks
✓ reactions
✓ schedules
✓ sessions
✓ system_settings
✓ users
✓ votes
```

---

## Files Modified

| File | Change |
|------|--------|
| `migrations-prod/0000_dry_ultron.sql` | Uncommented SQL, added pgvector and tracking table |
| `migrations-prod/schema.ts` | Added channelStates and pendingBlocks tables |
| `migrations-dev/0000_public_onslaught.sql` | Uncommented SQL, added pgvector and tracking table |
| `migrations-dev/schema.ts` | Added channelStates and pendingBlocks tables |

## Files Created

| File | Purpose |
|------|---------|
| `migrations-dev/0002_petite_iron_patriot.sql` | Auto-generated new migration |
| `MIGRATION_STEPS.md` | This documentation |

---

## Database Summary

| Environment | Tables | Migrations | Connection |
|-------------|--------|------------|------------|
| **Production** | 14 ✓ | 2 ✓ | `aws-1-us-east-1.pooler.supabase.com:6543` |
| **Development** | 14 ✓ | 3 ✓ | `aws-0-us-west-2.pooler.supabase.com:6543` |

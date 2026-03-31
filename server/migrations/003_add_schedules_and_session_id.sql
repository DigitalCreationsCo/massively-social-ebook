-- Migration: Add schedules table and sessionId to blocks/votes
-- This migration safely transforms existing data while maintaining referential integrity
-- Run with: drizzle-kit migrate

BEGIN;

-- 1. Create schedules table
CREATE TABLE schedules (
  id               SERIAL PRIMARY KEY,
  channel_id       TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  scheduled_days   TEXT[],
  scheduled_time   TEXT,
  interval_enabled BOOLEAN NOT NULL DEFAULT false,
  timezone         TEXT NOT NULL DEFAULT 'UTC',
  next_run_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Migrate recurrence data from sessions → schedules
-- For every channel that has interval_enabled=true or scheduledDays IS NOT NULL,
-- create a schedule row. Using DISTINCT ON to get one schedule per channel.
INSERT INTO schedules (channel_id, scheduled_days, scheduled_time, interval_enabled, timezone, next_run_at, created_at)
SELECT DISTINCT ON (channel_id)
  channel_id,
  scheduled_days,
  scheduled_time,
  interval_enabled,
  timezone,
  next_run_at,
  created_at
FROM sessions
WHERE interval_enabled = true OR scheduled_days IS NOT NULL;

-- 3. Add schedule_id column to sessions (nullable initially)
ALTER TABLE sessions ADD COLUMN schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL;

-- 4. Backfill schedule_id on sessions where a matching schedule was created
UPDATE sessions s
SET schedule_id = sc.id
FROM schedules sc
WHERE s.channel_id = sc.channel_id
  AND (s.interval_enabled = true OR s.scheduled_days IS NOT NULL);

-- 5. Drop recurrence columns from sessions
ALTER TABLE sessions
  DROP COLUMN IF EXISTS scheduled_days,
  DROP COLUMN IF EXISTS scheduled_time,
  DROP COLUMN IF EXISTS interval_enabled,
  DROP COLUMN IF EXISTS timezone,
  DROP COLUMN IF EXISTS next_run_at;

-- 6. Add sessionId to blocks (nullable first, then backfill, then constrain)
ALTER TABLE blocks ADD COLUMN session_id INTEGER;

-- 6a. Backfill session_id on existing blocks
-- Assign each block to the most recent session in the same channel
-- that was active/completed at or before the block's created_at
UPDATE blocks b
SET session_id = sub.session_id
FROM (
  SELECT b.id AS block_id, s.id AS session_id
  FROM blocks b
  INNER JOIN sessions s ON s.channel_id = b.channel_id
  WHERE s.scheduled_start <= COALESCE(b.created_at, NOW())
  ORDER BY b.id, s.scheduled_start DESC
) sub
WHERE b.id = sub.block_id;

-- 6b. Drop the old FK on channelId and recreate with constraint
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS fk_blocks_channel;
ALTER TABLE blocks ADD CONSTRAINT fk_blocks_channel FOREIGN KEY (channel_id) REFERENCES channels(channel_id) ON DELETE CASCADE;

-- 6c. Add FK to sessions and set NOT NULL
ALTER TABLE blocks ADD CONSTRAINT fk_blocks_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
ALTER TABLE blocks ALTER COLUMN session_id SET NOT NULL;

-- 7. Add sessionId to votes
ALTER TABLE votes ADD COLUMN session_id INTEGER;

-- 7a. Backfill session_id from blocks
UPDATE votes v
SET session_id = b.session_id
FROM blocks b
WHERE v.block_id = b.id;

-- 7b. Add FK to sessions and set NOT NULL
ALTER TABLE votes ADD CONSTRAINT fk_votes_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
ALTER TABLE votes ALTER COLUMN session_id SET NOT NULL;

-- 8. Add FK constraints to reactions (columns already exist, just add constraints)
ALTER TABLE reactions
  ADD CONSTRAINT fk_reactions_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_reactions_block FOREIGN KEY (block_id) REFERENCES blocks(id) ON DELETE CASCADE;

-- 9. Add FK constraint to lore (just add constraint, column already exists)
ALTER TABLE lore ADD CONSTRAINT fk_lore_channel FOREIGN KEY (channel_id) REFERENCES channels(channel_id) ON DELETE CASCADE;

-- 10. Add target_type to notification_logs for disambiguation
ALTER TABLE notification_logs ADD COLUMN target_type TEXT NOT NULL DEFAULT 'session';
ALTER TABLE notification_logs ALTER COLUMN target_type DROP DEFAULT;

-- ─── Indexes ───────────────────────────────────────────────────────────────────

-- Scheduler hot path: find due schedules efficiently
CREATE INDEX idx_schedules_next_run_at ON schedules(next_run_at) WHERE interval_enabled = true;

-- Session lookups by channel + status
CREATE INDEX idx_sessions_channel_status ON sessions(channel_id, status);

-- Session lookups by schedule (for "show me all airings of this schedule")
CREATE INDEX idx_sessions_schedule_id ON sessions(schedule_id) WHERE schedule_id IS NOT NULL;

-- Block lookups by session (primary read path)
CREATE INDEX idx_blocks_session_id ON blocks(session_id);

-- Vote lookups by session
CREATE INDEX idx_votes_session_id ON votes(session_id);

-- Notification dedup check
CREATE INDEX idx_notification_logs_target ON notification_logs(target_type, target_id, type);

COMMIT;

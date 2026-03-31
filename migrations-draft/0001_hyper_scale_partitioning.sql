-- Migration for Hyper-Scale Partitioning Architecture
-- Author: Principal Performance Engineer
-- Date: 2026-03-08

-- 1. Rename existing tables to _legacy to preserve data safely
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'blocks') THEN
        ALTER TABLE blocks RENAME TO blocks_legacy;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'votes') THEN
        ALTER TABLE votes RENAME TO votes_legacy;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'chat') THEN
        ALTER TABLE chat RENAME TO chat_legacy;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sessions') THEN
        ALTER TABLE sessions RENAME TO sessions_legacy;
    END IF;
END
$$;

-- 2. Create Sessions (List Partitioned)
CREATE TABLE sessions (
    id BIGSERIAL,
    channel_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    scheduled_start TIMESTAMPTZ NOT NULL,
    scheduled_end TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (channel_id, id)
) PARTITION BY LIST (channel_id);

CREATE TABLE sessions_mystery PARTITION OF sessions FOR VALUES IN ('mystery');
CREATE TABLE sessions_scifi PARTITION OF sessions FOR VALUES IN ('scifi');
CREATE TABLE sessions_default PARTITION OF sessions DEFAULT;

-- 3. Create Blocks (Range Partitioned by Time)
CREATE TABLE blocks (
    id BIGSERIAL,
    session_id BIGINT NOT NULL,
    channel_id TEXT NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    image_url TEXT,
    option_a JSONB,
    option_b JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE blocks_default PARTITION OF blocks DEFAULT;
CREATE INDEX idx_blocks_time_brin ON blocks USING BRIN (created_at);

-- 4. Create Votes (Range Partitioned by Time)
CREATE TABLE votes (
    session_id BIGINT NOT NULL,
    block_id BIGINT NOT NULL,
    user_id TEXT NOT NULL,
    choice CHAR(1) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_id, block_id, user_id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE votes_default PARTITION OF votes DEFAULT;
CREATE INDEX idx_votes_time_brin ON votes USING BRIN (created_at);

-- 5. Create Chat (Range Partitioned by Time)
CREATE TABLE chat (
    id BIGSERIAL,
    session_id BIGINT NOT NULL,
    channel_id TEXT NOT NULL,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE chat_default PARTITION OF chat DEFAULT;
CREATE INDEX idx_chat_time_brin ON chat USING BRIN (created_at);

-- 6. Create Separated Notification Tables
CREATE TABLE notifications_session_warning (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL,
    user_id TEXT NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notifications_daily (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notifications_weekly (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW()
);
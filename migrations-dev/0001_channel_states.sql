CREATE TABLE channel_states (
  channel_id              TEXT PRIMARY KEY REFERENCES channels(channel_id) ON DELETE CASCADE,
  current_phase           TEXT NOT NULL DEFAULT 'reading',
  phase_ends_at           TIMESTAMPTZ NOT NULL,
  decision_ends_at        TIMESTAMPTZ NOT NULL,
  initial_time_to_decision INTEGER NOT NULL DEFAULT 0,
  turns_to_next_choice    INTEGER NOT NULL DEFAULT 3,
  current_block_id        INTEGER REFERENCES blocks(id) ON DELETE SET NULL,
  active_session_id       INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  processing_locked_until TIMESTAMPTZ,
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pending_blocks (
  id           SERIAL PRIMARY KEY,
  channel_id   TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  for_block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  choice       TEXT NOT NULL,   -- 'A' | 'B'
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  image_url    TEXT NOT NULL,
  option_a     JSONB,
  option_b     JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (for_block_id, choice)
);
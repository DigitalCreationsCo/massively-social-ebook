-- Migration: Add audio_url to blocks and backing_track_url to sessions
-- This persists generated TTS audio file references so they can be
-- reused instead of regenerated on every block display.

ALTER TABLE blocks ADD COLUMN audio_url TEXT;

ALTER TABLE sessions ADD COLUMN backing_track_url TEXT;

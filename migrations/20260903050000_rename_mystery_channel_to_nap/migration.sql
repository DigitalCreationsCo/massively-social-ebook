-- Migration: rename 'mystery' channel to 'nap://25th-chapter'
-- Date: 2026-09-03
--
-- All FKs from channels(channel_id) are ON UPDATE CASCADE, so updating the
-- parent row cascades to: channel_states, schedules, sessions, blocks,
-- pending_blocks, lore, votes, chat, reactions.
-- The explicit child-table UPDATEs below are safety no-ops if cascade worked,
-- and cover any rows that might exist without a cascade path.
-- Idempotent: safe to re-run (affects 0 rows when already renamed).
-- Run against dev first (.env.local), then prod (.env.production.local) separately.

UPDATE "channels" SET "channel_id" = 'nap://25th-chapter' WHERE "channel_id" = 'mystery' AND NOT EXISTS (SELECT 1 FROM "channels" WHERE "channel_id" = 'nap://25th-chapter');--> statement-breakpoint
UPDATE "channel_states" SET "channel_id" = 'nap://25th-chapter' WHERE "channel_id" = 'mystery';--> statement-breakpoint
UPDATE "schedules" SET "channel_id" = 'nap://25th-chapter' WHERE "channel_id" = 'mystery';--> statement-breakpoint
UPDATE "sessions" SET "channel_id" = 'nap://25th-chapter' WHERE "channel_id" = 'mystery';--> statement-breakpoint
UPDATE "blocks" SET "channel_id" = 'nap://25th-chapter' WHERE "channel_id" = 'mystery';--> statement-breakpoint
UPDATE "pending_blocks" SET "channel_id" = 'nap://25th-chapter' WHERE "channel_id" = 'mystery';--> statement-breakpoint
UPDATE "lore" SET "channel_id" = 'nap://25th-chapter' WHERE "channel_id" = 'mystery';--> statement-breakpoint
UPDATE "votes" SET "channel_id" = 'nap://25th-chapter' WHERE "channel_id" = 'mystery';--> statement-breakpoint
UPDATE "chat" SET "channel_id" = 'nap://25th-chapter' WHERE "channel_id" = 'mystery';--> statement-breakpoint
UPDATE "reactions" SET "channel_id" = 'nap://25th-chapter' WHERE "channel_id" = 'mystery';

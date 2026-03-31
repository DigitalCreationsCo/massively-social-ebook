CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "blocks" (
	"id" serial PRIMARY KEY,
	"channel_id" text NOT NULL,
	"session_id" integer NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"image_url" text,
	"option_a" jsonb,
	"option_b" jsonb,
	"is_notable" boolean DEFAULT false NOT NULL,
	"embedding" vector(768),
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "channel_states" (
	"channel_id" text PRIMARY KEY,
	"current_phase" text DEFAULT 'reading' NOT NULL,
	"phase_ends_at" timestamp NOT NULL,
	"decision_ends_at" timestamp NOT NULL,
	"initial_time_to_decision" integer DEFAULT 0 NOT NULL,
	"turns_to_next_choice" integer DEFAULT 3 NOT NULL,
	"current_block_id" integer,
	"active_session_id" integer,
	"processing_locked_until" timestamp,
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "channels" (
	"id" serial PRIMARY KEY,
	"channel_id" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "chat" (
	"id" serial PRIMARY KEY,
	"channel_id" text NOT NULL,
	"session_id" integer,
	"username" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "lore" (
	"id" serial PRIMARY KEY,
	"channel_id" text NOT NULL,
	"content" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "notification_logs" (
	"id" serial PRIMARY KEY,
	"type" text NOT NULL,
	"target_type" text DEFAULT 'session' NOT NULL,
	"target_id" text NOT NULL,
	"sent_at" timestamp DEFAULT now(),
	"status" text NOT NULL,
	"metadata" jsonb
);

CREATE TABLE "pending_blocks" (
	"id" serial PRIMARY KEY,
	"channel_id" text NOT NULL,
	"for_block_id" integer NOT NULL,
	"choice" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"image_url" text NOT NULL,
	"option_a" jsonb,
	"option_b" jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "reactions" (
	"id" serial PRIMARY KEY,
	"channel_id" text NOT NULL,
	"session_id" integer NOT NULL,
	"block_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"paragraph_index" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "schedules" (
	"id" serial PRIMARY KEY,
	"channel_id" text NOT NULL,
	"scheduled_days" text[],
	"scheduled_time" text,
	"interval_enabled" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"next_run_at" timestamp,
	"title_config" jsonb,
	"session_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY,
	"channel_id" text NOT NULL,
	"schedule_id" integer,
	"title" text NOT NULL,
	"description" text,
	"scheduled_start" timestamp NOT NULL,
	"scheduled_end" timestamp NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notify_count" integer DEFAULT 0 NOT NULL,
	"session_number" integer,
	"season_number" integer,
	"episode_number" integer,
	"subtitle" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "users" (
	"id" serial PRIMARY KEY,
	"email" text UNIQUE,
	"push_token" text,
	"is_banned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "votes" (
	"id" serial PRIMARY KEY,
	"channel_id" text NOT NULL,
	"session_id" integer NOT NULL,
	"block_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"choice" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);

ALTER TABLE "blocks" ADD CONSTRAINT "blocks_channel_id_channels_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("channel_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;
ALTER TABLE "channel_states" ADD CONSTRAINT "channel_states_channel_id_channels_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("channel_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "channel_states" ADD CONSTRAINT "channel_states_current_block_id_blocks_id_fkey" FOREIGN KEY ("current_block_id") REFERENCES "blocks"("id") ON DELETE SET NULL;
ALTER TABLE "channel_states" ADD CONSTRAINT "channel_states_active_session_id_sessions_id_fkey" FOREIGN KEY ("active_session_id") REFERENCES "sessions"("id") ON DELETE SET NULL;
ALTER TABLE "chat" ADD CONSTRAINT "chat_channel_id_channels_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("channel_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat" ADD CONSTRAINT "chat_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL;
ALTER TABLE "lore" ADD CONSTRAINT "lore_channel_id_channels_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("channel_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pending_blocks" ADD CONSTRAINT "pending_blocks_channel_id_channels_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("channel_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pending_blocks" ADD CONSTRAINT "pending_blocks_for_block_id_blocks_id_fkey" FOREIGN KEY ("for_block_id") REFERENCES "blocks"("id") ON DELETE CASCADE;
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_channel_id_channels_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("channel_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_block_id_blocks_id_fkey" FOREIGN KEY ("block_id") REFERENCES "blocks"("id") ON DELETE CASCADE;
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_channel_id_channels_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("channel_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_channel_id_channels_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("channel_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_schedule_id_schedules_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE SET NULL;
ALTER TABLE "votes" ADD CONSTRAINT "votes_channel_id_channels_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("channel_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "votes" ADD CONSTRAINT "votes_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;
ALTER TABLE "votes" ADD CONSTRAINT "votes_block_id_blocks_id_fkey" FOREIGN KEY ("block_id") REFERENCES "blocks"("id") ON DELETE CASCADE;
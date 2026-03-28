-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;

-- Create drizzle migrations tracking table (REQUIRED for Drizzle Kit v7+)
CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
  "id" serial PRIMARY KEY,
  "hash" text NOT NULL,
  "created_at" bigint
);

-- Current sql file was generated after introspecting the database
CREATE TABLE "reactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"session_id" integer NOT NULL,
	"block_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"paragraph_index" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" serial PRIMARY KEY NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"target_type" text DEFAULT 'session' NOT NULL,
	"target_id" text NOT NULL,
	"sent_at" timestamp DEFAULT now(),
	"status" text NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "channels_channel_id_unique" UNIQUE("channel_id")
);
--> statement-breakpoint
CREATE TABLE "chat" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"session_id" integer,
	"username" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lore" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"content" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"session_id" integer NOT NULL,
	"block_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"choice" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text,
	"push_token" text,
	"is_banned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" serial PRIMARY KEY NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
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
--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lore" ADD CONSTRAINT "lore_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;

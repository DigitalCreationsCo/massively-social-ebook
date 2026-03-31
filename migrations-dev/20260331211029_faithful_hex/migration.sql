CREATE TABLE "notifications_daily" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications_session_warning" (
	"id" serial PRIMARY KEY,
	"session_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications_weekly" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "votes" DROP CONSTRAINT "votes_pkey";--> statement-breakpoint
ALTER TABLE "votes" ADD PRIMARY KEY ("session_id","block_id","user_id","created_at");--> statement-breakpoint
ALTER TABLE "blocks" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_states" ALTER COLUMN "phase_ends_at" SET DATA TYPE timestamp with time zone USING "phase_ends_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_states" ALTER COLUMN "decision_ends_at" SET DATA TYPE timestamp with time zone USING "decision_ends_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_states" ALTER COLUMN "processing_locked_until" SET DATA TYPE timestamp with time zone USING "processing_locked_until"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_states" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lore" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_logs" ALTER COLUMN "sent_at" SET DATA TYPE timestamp with time zone USING "sent_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pending_blocks" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reactions" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedules" ALTER COLUMN "next_run_at" SET DATA TYPE timestamp with time zone USING "next_run_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedules" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "scheduled_start" SET DATA TYPE timestamp with time zone USING "scheduled_start"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "scheduled_end" SET DATA TYPE timestamp with time zone USING "scheduled_end"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "system_settings" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "votes" ALTER COLUMN "choice" SET DATA TYPE char(1) USING "choice"::char(1);--> statement-breakpoint
ALTER TABLE "votes" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;
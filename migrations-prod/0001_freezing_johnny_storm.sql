CREATE TABLE "channel_states" (
	"channel_id" text PRIMARY KEY NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "pending_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
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
--> statement-breakpoint
ALTER TABLE "channel_states" ADD CONSTRAINT "channel_states_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_states" ADD CONSTRAINT "channel_states_current_block_id_blocks_id_fk" FOREIGN KEY ("current_block_id") REFERENCES "public"."blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_states" ADD CONSTRAINT "channel_states_active_session_id_sessions_id_fk" FOREIGN KEY ("active_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_blocks" ADD CONSTRAINT "pending_blocks_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_blocks" ADD CONSTRAINT "pending_blocks_for_block_id_blocks_id_fk" FOREIGN KEY ("for_block_id") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "blocks" DROP CONSTRAINT "blocks_channel_id_channels_channel_id_fk";
--> statement-breakpoint
ALTER TABLE "channel_states" DROP CONSTRAINT "channel_states_channel_id_channels_channel_id_fk";
--> statement-breakpoint
ALTER TABLE "chat" DROP CONSTRAINT "chat_channel_id_channels_channel_id_fk";
--> statement-breakpoint
ALTER TABLE "lore" DROP CONSTRAINT "lore_channel_id_channels_channel_id_fk";
--> statement-breakpoint
ALTER TABLE "pending_blocks" DROP CONSTRAINT "pending_blocks_channel_id_channels_channel_id_fk";
--> statement-breakpoint
ALTER TABLE "reactions" DROP CONSTRAINT "reactions_channel_id_channels_channel_id_fk";
--> statement-breakpoint
ALTER TABLE "schedules" DROP CONSTRAINT "schedules_channel_id_channels_channel_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_channel_id_channels_channel_id_fk";
--> statement-breakpoint
ALTER TABLE "votes" DROP CONSTRAINT "votes_channel_id_channels_channel_id_fk";
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "channel_states" ADD CONSTRAINT "channel_states_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lore" ADD CONSTRAINT "lore_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pending_blocks" ADD CONSTRAINT "pending_blocks_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE cascade;
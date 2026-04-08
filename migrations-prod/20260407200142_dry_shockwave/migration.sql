ALTER TABLE "blocks" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('english', "blocks"."content")) STORED;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "unq_channel_start" UNIQUE("channel_id","scheduled_start");--> statement-breakpoint
CREATE INDEX "idx_blocks_channel_id" ON "blocks" ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_blocks_session_id" ON "blocks" ("session_id");--> statement-breakpoint
CREATE INDEX "idx_blocks_embedding" ON "blocks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "idx_blocks_search" ON "blocks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "idx_sessions_status_start" ON "sessions" ("status","scheduled_start") WHERE status IN ('active', 'scheduled');
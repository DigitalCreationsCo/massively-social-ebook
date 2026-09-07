CREATE INDEX "idx_blocks_channel_sequence" ON "blocks" ("channel_id", "id");
--> statement-breakpoint
CREATE INDEX "idx_blocks_channel_notable_sequence" ON "blocks" ("channel_id", "is_notable", "id");

-- Add video support to blocks table for video streaming capability
ALTER TABLE "blocks"
  ADD COLUMN IF NOT EXISTS "video_url" text;

-- Add index for video URL queries
CREATE INDEX IF NOT EXISTS "idx_blocks_video_url" ON "blocks" ("video_url") WHERE "video_url" IS NOT NULL;

-- Add comment to document the video column
COMMENT ON COLUMN "blocks"."video_url" IS 'URL to archived video file with embedded audio for video streaming turns';

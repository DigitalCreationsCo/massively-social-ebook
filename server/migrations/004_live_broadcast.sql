ALTER TABLE "blocks"
  ADD COLUMN IF NOT EXISTS "delivery_segments" jsonb;

ALTER TABLE "chat"
  ADD COLUMN IF NOT EXISTS "message_id" text,
  ADD COLUMN IF NOT EXISTS "author_id" text,
  ADD COLUMN IF NOT EXISTS "author_display_name" text,
  ADD COLUMN IF NOT EXISTS "sent_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "provenance" jsonb;

UPDATE "chat"
SET
  "message_id" = COALESCE("message_id", 'legacy:' || "id"::text),
  "author_id" = COALESCE("author_id", 'legacy:' || COALESCE(NULLIF("username", ''), "id"::text)),
  "author_display_name" = COALESCE("author_display_name", NULLIF("username", ''), 'Guest'),
  "sent_at" = COALESCE("sent_at", "created_at", now()),
  "provenance" = COALESCE("provenance", '{"kind":"portals"}'::jsonb);

ALTER TABLE "chat"
  ALTER COLUMN "message_id" SET DEFAULT ('legacy:' || md5(random()::text || clock_timestamp()::text)),
  ALTER COLUMN "message_id" SET NOT NULL,
  ALTER COLUMN "author_id" SET DEFAULT 'legacy:anonymous',
  ALTER COLUMN "author_id" SET NOT NULL,
  ALTER COLUMN "sent_at" SET DEFAULT now(),
  ALTER COLUMN "sent_at" SET NOT NULL,
  ALTER COLUMN "provenance" SET DEFAULT '{"kind":"portals"}'::jsonb,
  ALTER COLUMN "provenance" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "unq_chat_message_id" ON "chat" ("message_id");

-- Rename the path-unsafe `nap://25th-chapter` channel key to the bare NAP
-- repository ID `25th-chapter`.
--
-- The parent update cascades to every FK-backed channel_id column. Broadcast
-- system-setting keys are not foreign keys, so they move explicitly. Existing
-- queue receipts embed the old channel key; clear those receipts so the ebook
-- can stage the archived canonical media under fresh, routable slot keys.
--
-- This migration intentionally refuses a channel-key collision rather than
-- silently merging two distinct programs.
DO $$
DECLARE
  legacy_channel_id CONSTANT text := 'nap://25th-chapter';
  canonical_channel_id CONSTANT text := '25th-chapter';
  legacy_setting_prefix CONSTANT text := 'broadcast:nap://25th-chapter:';
  canonical_setting_prefix CONSTANT text := 'broadcast:25th-chapter:';
  renamed boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM channels WHERE channel_id = legacy_channel_id)
     AND EXISTS (SELECT 1 FROM channels WHERE channel_id = canonical_channel_id) THEN
    RAISE EXCEPTION 'cannot rename % to %: both channel rows exist', legacy_channel_id, canonical_channel_id;
  END IF;

  UPDATE channels
  SET channel_id = canonical_channel_id
  WHERE channel_id = legacy_channel_id;
  renamed := FOUND;

  IF NOT renamed THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM system_settings legacy
    WHERE legacy.key LIKE legacy_setting_prefix || '%'
      AND EXISTS (
        SELECT 1
        FROM system_settings canonical
        WHERE canonical.key = canonical_setting_prefix
          || substring(legacy.key FROM char_length(legacy_setting_prefix) + 1)
      )
  ) THEN
    RAISE EXCEPTION 'cannot rename broadcast settings for %: target setting already exists', legacy_channel_id;
  END IF;

  UPDATE system_settings
  SET key = canonical_setting_prefix
    || substring(key FROM char_length(legacy_setting_prefix) + 1)
  WHERE key LIKE legacy_setting_prefix || '%';

  UPDATE blocks
  SET delivery_segments = COALESCE(
    (
      SELECT jsonb_agg(
        segment
          - ARRAY['queuePairId', 'queueIdempotencyKey', 'queueSlotKey', 'queueImageJobId', 'queueAudioJobId']
        ORDER BY ordinal
      )
      FROM jsonb_array_elements(delivery_segments) WITH ORDINALITY AS item(segment, ordinal)
    ),
    '[]'::jsonb
  )
  WHERE channel_id = canonical_channel_id
    AND delivery_segments IS NOT NULL;
END $$;

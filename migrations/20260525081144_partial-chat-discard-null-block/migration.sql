CREATE INDEX IF NOT EXISTS idx_chat_block_not_null
ON chat (block_id, created_at ASC)
WHERE block_id IS NOT NULL;

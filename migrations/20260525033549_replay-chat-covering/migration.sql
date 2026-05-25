CREATE INDEX idx_chat_block_created_covering
ON chat (block_id, created_at)
INCLUDE (
  id,
  username,
  text,
  session_id,
  channel_id
);

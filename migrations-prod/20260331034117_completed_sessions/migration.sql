-- Optimized for: Marking sessions as 'completed'
-- Supports: WHERE status IN ('active', 'scheduled') AND scheduled_end < NOW()
CREATE INDEX idx_sessions_cleanup 
ON sessions (status, scheduled_end);
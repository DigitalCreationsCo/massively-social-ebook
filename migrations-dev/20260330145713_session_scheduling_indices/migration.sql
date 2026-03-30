-- Supports: WHERE channel_id = X AND status = 'scheduled' AND scheduled_start BETWEEN Y AND Z
CREATE INDEX idx_sessions_channel_status_start 
ON sessions (channel_id, status, scheduled_start);

-- Supports: WHERE interval_enabled = true
CREATE INDEX idx_schedules_enabled 
ON schedules (interval_enabled) 
WHERE interval_enabled = true;

-- Supports: WHERE status = 'scheduled' AND scheduled_start BETWEEN Y AND Z (across all channels)
CREATE INDEX idx_sessions_global_warnings 
ON sessions (status, scheduled_start);
-- 0014_session_trash.sql
-- Soft delete. NULL = live; a timestamp means the row was moved to Storage
-- (trash) and is hidden from normal lists but still recoverable.

ALTER TABLE sessions ADD COLUMN deleted_at TEXT;
ALTER TABLE branches ADD COLUMN deleted_at TEXT;

CREATE INDEX idx_sessions_deleted_at ON sessions(deleted_at);
CREATE INDEX idx_branches_deleted_at ON branches(deleted_at);

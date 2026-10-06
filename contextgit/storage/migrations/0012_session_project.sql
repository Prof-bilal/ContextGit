-- The project folder each run belongs to, so the rail can group runs by project.
-- NULL for runs created before this column existed (backfilled from worktree_path).
ALTER TABLE sessions ADD COLUMN project_path TEXT;

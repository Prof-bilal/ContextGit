-- 0003_worktrees.sql
-- Pair each run's ContextGit branch (conversation) with a real git worktree
-- (code), so parallel agents never share a working directory. All nullable:
-- a non-git project falls back to the shared workspace.

ALTER TABLE sessions ADD COLUMN worktree_path TEXT;   -- absolute path, NULL = shared workspace
ALTER TABLE sessions ADD COLUMN git_branch TEXT;      -- real git branch, e.g. ctx/<slug>
ALTER TABLE sessions ADD COLUMN base_ref TEXT;        -- fresh | head | a branch name
ALTER TABLE sessions ADD COLUMN base_commit TEXT;     -- resolved SHA at create time
ALTER TABLE sessions ADD COLUMN task TEXT;            -- one-line goal
ALTER TABLE sessions ADD COLUMN scope TEXT;           -- JSON array of path globs claimed

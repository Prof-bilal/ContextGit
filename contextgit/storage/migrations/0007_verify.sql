-- 0007_verify.sql
-- Quality gate + independent review for team tasks, and per-run port isolation.
--
-- A task completes into `review`: the gate (the project's own test/lint command)
-- runs in the run's worktree and records its verdict here, then a human approves
-- or requests changes. `tasks.tokens` is derived (not stored): the committed
-- context size of the task's branch.

ALTER TABLE teams ADD COLUMN gate_command TEXT;

ALTER TABLE tasks ADD COLUMN gate_command TEXT;
ALTER TABLE tasks ADD COLUMN verifier_session_id TEXT;
ALTER TABLE tasks ADD COLUMN gate_status TEXT;
ALTER TABLE tasks ADD COLUMN gate_exit_code INTEGER;
ALTER TABLE tasks ADD COLUMN gate_output TEXT;
ALTER TABLE tasks ADD COLUMN gate_ran_at TEXT;
ALTER TABLE tasks ADD COLUMN review_note TEXT;

-- A stable local port per run, so two runs' dev servers cannot collide.
ALTER TABLE sessions ADD COLUMN port INTEGER;

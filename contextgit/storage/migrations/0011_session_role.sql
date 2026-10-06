-- A run's role and the skills auto-loaded for it (human-readable labels).
-- `skills` is a JSON array; empty for runs started without a role.
ALTER TABLE sessions ADD COLUMN role TEXT;
ALTER TABLE sessions ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';

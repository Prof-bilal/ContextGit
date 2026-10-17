-- Parent link: a task may be a subtask of another task in the same team.
ALTER TABLE tasks ADD COLUMN parent_id TEXT;

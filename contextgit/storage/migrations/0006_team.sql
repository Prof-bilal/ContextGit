-- 0006_team.sql
-- Team mode: one mission per project, split into a task graph.
-- A task is owned by one run (a Phase-A session: worktree + context branch),
-- claims a file scope, and may depend on other tasks. The `team_messages`
-- table is the board feed — how runs "talk" across worktrees.
-- Note: `messages` is already taken (0001: commit messages), hence `team_messages`.

CREATE TABLE teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    project_path TEXT NOT NULL,
    base_ref TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    brief TEXT NOT NULL DEFAULT '',
    done_criteria TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'implementer',
    status TEXT NOT NULL DEFAULT 'todo',
    agent TEXT,
    session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    scope TEXT NOT NULL DEFAULT '[]',
    contract TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE task_deps (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, depends_on_task_id)
);

CREATE TABLE team_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    task_id TEXT,
    from_task_id TEXT,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE team_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    task_id TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE INDEX idx_tasks_team ON tasks(team_id);
CREATE INDEX idx_task_deps_task ON task_deps(task_id);
CREATE INDEX idx_team_messages_team ON team_messages(team_id);

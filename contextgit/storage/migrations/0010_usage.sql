-- Token usage events: one row per LLM call (or per committed CLI turn).
-- `source` is 'provider' when the provider reported real usage, 'estimate' when
-- we fell back to the ~4-chars heuristic (research, CLI/PTY, providers that do
-- not return a usage frame).
CREATE TABLE usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    surface TEXT NOT NULL CHECK (surface IN ('chat', 'council', 'research', 'image', 'code')),
    source TEXT NOT NULL CHECK (source IN ('provider', 'estimate')),
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    session_id TEXT,
    branch TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX usage_events_created_at ON usage_events (created_at);

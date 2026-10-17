CREATE TABLE IF NOT EXISTS agent_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    aggregate_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    source TEXT NOT NULL,
    payload_version INTEGER NOT NULL,
    correlation_id TEXT,
    task_id TEXT,
    session_id TEXT,
    run_id TEXT,
    capture TEXT NOT NULL,
    data_label TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS agent_events_aggregate ON agent_events (aggregate_id, seq);

CREATE TRIGGER IF NOT EXISTS agent_events_no_update
BEFORE UPDATE ON agent_events
BEGIN
    SELECT RAISE(ABORT, 'agent_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS agent_events_no_delete
BEFORE DELETE ON agent_events
BEGIN
    SELECT RAISE(ABORT, 'agent_events is append-only');
END;

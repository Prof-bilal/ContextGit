-- 0005_merge_queue.sql
-- Ordered queue of runs waiting to merge into a target branch. Merging is
-- sequential (one at a time, re-checking against the moved target) so parallel
-- runs do not collide at the merge step.

CREATE TABLE merge_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    target TEXT NOT NULL,
    position INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'merged', 'blocked', 'failed')),
    conflicts TEXT,                 -- JSON array of conflicted paths
    commit_id TEXT,                 -- merge commit once merged
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_merge_queue_order ON merge_queue(position);

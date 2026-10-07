-- 0015_http_history.sql
-- The API tab's request history: method, URL, status, timing and size. A tiny
-- audit trail of what you sent; collections live as files under <repo>/api/.

CREATE TABLE http_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  status INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_http_history_created_at ON http_history(created_at);

-- 0016_run_env.sql
-- What environment a run had: variable names and value hashes, never values.
-- Comparing two runs ("it worked yesterday") is then a real diff instead of a
-- guess, and nothing secret is stored.

CREATE TABLE run_env (
  session_id TEXT NOT NULL,
  key TEXT NOT NULL,
  hash TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (session_id, key)
);

CREATE INDEX idx_run_env_session ON run_env(session_id);

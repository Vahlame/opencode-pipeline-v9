-- Fase 3: scheduler, leases, worktrees y ejecuciones.

CREATE TABLE leases (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL CHECK (length(owner_id) > 0),
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  expires_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_leases_expiry ON leases(expires_at);

CREATE TABLE worktrees (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  module_id TEXT REFERENCES modules(id) ON DELETE SET NULL,
  path TEXT NOT NULL CHECK (length(path) > 0),
  branch TEXT NOT NULL CHECK (length(branch) > 0),
  base_commit TEXT NOT NULL CHECK (length(base_commit) > 0),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMMITTED', 'FAILED', 'REMOVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (task_id),
  UNIQUE (path),
  UNIQUE (branch)
) STRICT;

CREATE INDEX idx_worktrees_status ON worktrees(status);

CREATE TABLE task_attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED')),
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  error TEXT,
  UNIQUE (task_id, attempt)
) STRICT;

CREATE INDEX idx_task_attempts_task ON task_attempts(task_id, attempt);
CREATE INDEX idx_task_attempts_status ON task_attempts(status);

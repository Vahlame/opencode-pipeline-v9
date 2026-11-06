-- Fase 6: recuperacion, operaciones idempotentes, recursos y observabilidad.

CREATE TABLE project_resources (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  estimated_cost_usd REAL NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
  last_limit_code TEXT,
  last_limit_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (length(kind) > 0),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) > 0),
  input_hash TEXT NOT NULL CHECK (length(input_hash) > 0),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  lease_expires_at TEXT NOT NULL,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, kind, idempotency_key)
) STRICT;

CREATE INDEX idx_operations_status_lease ON operations(status, lease_expires_at);

CREATE TABLE recovery_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('DRY_RUN', 'APPLY')),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  findings_count INTEGER NOT NULL DEFAULT 0 CHECK (findings_count >= 0),
  applied_count INTEGER NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
  summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
  error TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_recovery_runs_project ON recovery_runs(project_id, started_at);

CREATE TABLE recovery_actions (
  id TEXT PRIMARY KEY,
  recovery_run_id TEXT NOT NULL REFERENCES recovery_runs(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (length(code) > 0),
  entity_type TEXT NOT NULL CHECK (length(entity_type) > 0),
  entity_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('REQUIRED', 'APPLIED', 'SKIPPED', 'FAILED')),
  detail_json TEXT NOT NULL CHECK (json_valid(detail_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_recovery_actions_run ON recovery_actions(recovery_run_id, status);

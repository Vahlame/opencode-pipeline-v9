-- Fase 4: jurado, consolidación, rework y registro de módulos aprobados.

ALTER TABLE tasks ADD COLUMN review_cycle INTEGER NOT NULL DEFAULT 0 CHECK (review_cycle >= 0);

CREATE TABLE jury_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  module_version_id TEXT NOT NULL REFERENCES module_versions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  cycle INTEGER NOT NULL DEFAULT 0 CHECK (cycle >= 0),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (module_version_id)
) STRICT;

CREATE INDEX idx_jury_runs_project_status ON jury_runs(project_id, status);

CREATE TABLE jury_consolidations (
  id TEXT PRIMARY KEY,
  jury_run_id TEXT NOT NULL REFERENCES jury_runs(id) ON DELETE CASCADE,
  module_version_id TEXT NOT NULL REFERENCES module_versions(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('APPROVED', 'REWORK_REQUIRED', 'INCOMPLETE')),
  blocking_json TEXT NOT NULL CHECK (json_valid(blocking_json)),
  recommendations_json TEXT NOT NULL CHECK (json_valid(recommendations_json)),
  missing_roles_json TEXT NOT NULL CHECK (json_valid(missing_roles_json)),
  hash TEXT NOT NULL CHECK (length(hash) > 0),
  created_at TEXT NOT NULL,
  UNIQUE (module_version_id)
) STRICT;

CREATE INDEX idx_consolidations_verdict ON jury_consolidations(verdict, created_at);

CREATE TABLE approved_modules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  module_version_id TEXT NOT NULL REFERENCES module_versions(id) ON DELETE RESTRICT,
  commit_sha TEXT NOT NULL CHECK (length(commit_sha) = 40),
  artifact_hash TEXT NOT NULL CHECK (length(artifact_hash) > 0),
  approved_at TEXT NOT NULL,
  jury_run_id TEXT NOT NULL REFERENCES jury_runs(id) ON DELETE RESTRICT,
  UNIQUE (module_id, module_version_id)
) STRICT;

CREATE INDEX idx_approved_modules_project ON approved_modules(project_id, approved_at);

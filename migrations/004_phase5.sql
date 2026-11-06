-- Fase 5: integracion hibrida, feedback global y entrega final.

CREATE TABLE integration_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'STRUCTURAL_FAILED', 'FAILED')),
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  base_commit TEXT NOT NULL CHECK (length(base_commit) = 40),
  integration_path TEXT NOT NULL CHECK (length(integration_path) > 0),
  input_hash TEXT NOT NULL CHECK (length(input_hash) > 0),
  manifest_hash TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (project_id, plan_id, input_hash, attempt)
) STRICT;

CREATE INDEX idx_integration_runs_project_status ON integration_runs(project_id, status);
CREATE INDEX idx_integration_runs_input ON integration_runs(project_id, plan_id, input_hash);

CREATE TABLE integration_modules (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES integration_runs(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE RESTRICT,
  module_version_id TEXT NOT NULL REFERENCES module_versions(id) ON DELETE RESTRICT,
  commit_sha TEXT NOT NULL CHECK (length(commit_sha) = 40),
  artifact_hash TEXT NOT NULL CHECK (length(artifact_hash) > 0),
  contract_id TEXT REFERENCES contracts(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('INCLUDED', 'REJECTED')),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, module_id)
) STRICT;

CREATE INDEX idx_integration_modules_run ON integration_modules(run_id);
CREATE INDEX idx_integration_modules_version ON integration_modules(module_version_id);

CREATE TABLE integration_adapters (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES integration_runs(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE RESTRICT,
  path TEXT NOT NULL CHECK (length(path) > 0),
  commit_sha TEXT NOT NULL CHECK (length(commit_sha) = 40),
  version INTEGER NOT NULL CHECK (version > 0),
  tests_json TEXT NOT NULL CHECK (json_valid(tests_json)),
  review_json TEXT NOT NULL CHECK (json_valid(review_json)),
  status TEXT NOT NULL CHECK (status IN ('VALIDATED', 'REJECTED')),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, path)
) STRICT;

CREATE INDEX idx_integration_adapters_run ON integration_adapters(run_id, status);

CREATE TABLE integration_conflicts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES integration_runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('MINOR', 'STRUCTURAL')),
  code TEXT NOT NULL CHECK (length(code) > 0),
  message TEXT NOT NULL CHECK (length(message) > 0),
  modules_json TEXT NOT NULL CHECK (json_valid(modules_json)),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  resolution TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_integration_conflicts_run ON integration_conflicts(run_id, type);

CREATE TABLE integration_manifests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL REFERENCES integration_runs(id) ON DELETE RESTRICT,
  hash TEXT NOT NULL CHECK (length(hash) > 0),
  base_commit TEXT NOT NULL CHECK (length(base_commit) = 40),
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  created_at TEXT NOT NULL,
  UNIQUE (project_id, hash),
  UNIQUE (run_id)
) STRICT;

CREATE INDEX idx_integration_manifests_project ON integration_manifests(project_id, created_at);

CREATE TABLE feedback_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  manifest_id TEXT NOT NULL REFERENCES integration_manifests(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  verdict TEXT CHECK (verdict IS NULL OR verdict IN ('PASS', 'FAIL')),
  report_json TEXT NOT NULL CHECK (json_valid(report_json)),
  hash TEXT NOT NULL CHECK (length(hash) > 0),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (manifest_id)
) STRICT;

CREATE INDEX idx_feedback_runs_project ON feedback_runs(project_id, verdict, created_at);

CREATE TABLE final_deliveries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  manifest_id TEXT NOT NULL REFERENCES integration_manifests(id) ON DELETE RESTRICT,
  feedback_id TEXT NOT NULL REFERENCES feedback_runs(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('READY', 'DELIVERED')),
  summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  UNIQUE (manifest_id)
) STRICT;

CREATE INDEX idx_final_deliveries_project ON final_deliveries(project_id, status, created_at);

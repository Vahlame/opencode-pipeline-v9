-- Fase 2: núcleo persistente del orquestador.
-- Todas las tablas usan TEXT/INTEGER, claves foráneas y restricciones CHECK.

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) > 0),
  repo_path TEXT NOT NULL CHECK (length(repo_path) > 0),
  status TEXT NOT NULL CHECK (status IN (
    'DRAFT', 'PLAN_PROPOSED', 'AWAITING_APPROVAL', 'APPROVED', 'RUNNING',
    'PAUSED', 'INTEGRATING', 'FEEDBACK', 'COMPLETED', 'FAILED', 'CANCELLED'
  )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
) STRICT;

CREATE UNIQUE INDEX idx_projects_repo ON projects(repo_path);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  title TEXT NOT NULL CHECK (length(title) > 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PROPOSED', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
  spec_json TEXT NOT NULL CHECK (json_valid(spec_json)),
  plan_json TEXT NOT NULL CHECK (json_valid(plan_json)),
  hash TEXT NOT NULL CHECK (length(hash) > 0),
  proposed_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, version),
  UNIQUE (project_id, hash)
) STRICT;

CREATE INDEX idx_plans_project_status ON plans(project_id, status);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN (
    'PARENT', 'COORDINATOR', 'SPECIALIST', 'JUDGE_TESTS', 'JUDGE_DEBUG',
    'JUDGE_ARCHITECTURE', 'JUDGE_OPTIMIZATION', 'INTEGRATOR', 'FEEDBACK'
  )),
  name TEXT NOT NULL CHECK (length(name) > 0),
  opencode_agent_id TEXT NOT NULL CHECK (length(opencode_agent_id) > 0),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'OFFLINE')),
  capabilities_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(capabilities_json)),
  current_task_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, opencode_agent_id)
) STRICT;

CREATE INDEX idx_agents_project_role ON agents(project_id, role);
CREATE INDEX idx_agents_current_task ON agents(current_task_id);

CREATE TABLE modules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) > 0),
  owner_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  path_scope_json TEXT NOT NULL CHECK (json_valid(path_scope_json)),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'INTEGRATED', 'REWORK_REQUIRED', 'REJECTED')),
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, name)
) STRICT;

CREATE INDEX idx_modules_owner ON modules(owner_agent_id);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  module_id TEXT REFERENCES modules(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (length(title) > 0),
  description TEXT NOT NULL CHECK (length(description) > 0),
  state TEXT NOT NULL CHECK (state IN (
    'PENDING', 'READY', 'RUNNING', 'IN_REVIEW', 'REWORK_REQUIRED', 'APPROVED',
    'INTEGRATED', 'BLOCKED', 'PAUSED', 'FAILED', 'CANCELLED'
  )),
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  owner_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  contract_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
) STRICT;

CREATE INDEX idx_tasks_project_state ON tasks(project_id, state);
CREATE INDEX idx_tasks_owner ON tasks(owner_agent_id);
CREATE INDEX idx_tasks_module ON tasks(module_id);
CREATE INDEX idx_tasks_priority ON tasks(project_id, priority DESC);

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'REQUIRES' CHECK (kind IN ('REQUIRES', 'SOFT')),
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
) STRICT;

CREATE INDEX idx_task_dependencies_target ON task_dependencies(depends_on_task_id);

CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  objective TEXT NOT NULL CHECK (length(objective) > 0),
  allowed_paths_json TEXT NOT NULL CHECK (json_valid(allowed_paths_json)),
  input_interfaces_json TEXT NOT NULL CHECK (json_valid(input_interfaces_json)),
  output_interfaces_json TEXT NOT NULL CHECK (json_valid(output_interfaces_json)),
  acceptance_tests_json TEXT NOT NULL CHECK (json_valid(acceptance_tests_json)),
  limits_json TEXT NOT NULL CHECK (json_valid(limits_json)),
  delivery_format TEXT NOT NULL CHECK (length(delivery_format) > 0),
  hash TEXT NOT NULL CHECK (length(hash) > 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'REJECTED')),
  created_at TEXT NOT NULL,
  UNIQUE (task_id, version),
  UNIQUE (task_id, hash)
) STRICT;

CREATE INDEX idx_contracts_module_status ON contracts(module_id, status);

CREATE TABLE module_versions (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  commit_sha TEXT NOT NULL CHECK (length(commit_sha) = 40),
  tree_hash TEXT NOT NULL CHECK (length(tree_hash) > 0),
  artifact_hash TEXT NOT NULL CHECK (length(artifact_hash) > 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'INTEGRATED', 'REWORK_REQUIRED', 'REJECTED')),
  created_at TEXT NOT NULL,
  UNIQUE (module_id, version),
  UNIQUE (module_id, artifact_hash)
) STRICT;

CREATE INDEX idx_module_versions_module_status ON module_versions(module_id, status);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  opencode_session_id TEXT,
  worktree_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('STARTING', 'ACTIVE', 'IDLE', 'STOPPED', 'FAILED')),
  last_event_seq INTEGER CHECK (last_event_seq IS NULL OR last_event_seq >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (opencode_session_id)
) STRICT;

CREATE INDEX idx_sessions_project_status ON sessions(project_id, status);
CREATE INDEX idx_sessions_agent ON sessions(agent_id);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  to_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  correlation_id TEXT NOT NULL CHECK (length(correlation_id) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('INFO', 'QUERY', 'ORDER', 'PAUSE', 'CANCEL')),
  priority INTEGER NOT NULL DEFAULT 10 CHECK (priority BETWEEN 0 AND 100),
  state TEXT NOT NULL CHECK (state IN ('QUEUED', 'DELIVERED', 'ACKED', 'REJECTED', 'EXPIRED')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  requires_approval INTEGER NOT NULL DEFAULT 0 CHECK (requires_approval IN (0, 1)),
  approved_by TEXT,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) > 0),
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  acked_at TEXT,
  UNIQUE (project_id, idempotency_key)
) STRICT;

CREATE INDEX idx_messages_mailbox ON messages(to_agent_id, state, created_at);
CREATE INDEX idx_messages_correlation ON messages(project_id, correlation_id);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_version_id TEXT NOT NULL REFERENCES module_versions(id) ON DELETE CASCADE,
  judge_role TEXT NOT NULL CHECK (judge_role IN (
    'JUDGE_TESTS', 'JUDGE_DEBUG', 'JUDGE_ARCHITECTURE', 'JUDGE_OPTIMIZATION'
  )),
  verdict TEXT NOT NULL CHECK (verdict IN ('APPROVE', 'REJECT')),
  findings_json TEXT NOT NULL CHECK (json_valid(findings_json)),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  hash TEXT NOT NULL CHECK (length(hash) > 0),
  created_at TEXT NOT NULL,
  UNIQUE (module_version_id, judge_role)
) STRICT;

CREATE INDEX idx_reviews_project_verdict ON reviews(project_id, verdict);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('PLAN', 'CONTRACT', 'MODULE', 'INTEGRATION', 'DELIVERY')),
  subject_id TEXT NOT NULL CHECK (length(subject_id) > 0),
  subject_hash TEXT NOT NULL CHECK (length(subject_hash) > 0),
  approver_id TEXT NOT NULL CHECK (length(approver_id) > 0),
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, subject_type, subject_id, subject_hash, approver_id)
) STRICT;

CREATE INDEX idx_approvals_subject ON approvals(project_id, subject_type, subject_id);

CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (length(type) > 0),
  aggregate_type TEXT NOT NULL CHECK (length(aggregate_type) > 0),
  aggregate_id TEXT NOT NULL CHECK (length(aggregate_id) > 0),
  actor_id TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  trace_id TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_events_project_seq ON events(project_id, seq);
CREATE INDEX idx_events_aggregate ON events(aggregate_type, aggregate_id, seq);
CREATE INDEX idx_events_type ON events(type, created_at);

CREATE TABLE event_outbox (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  topic TEXT NOT NULL CHECK (length(topic) > 0),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'DELIVERING', 'DELIVERED', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  UNIQUE (event_id, topic)
) STRICT;

CREATE INDEX idx_outbox_status_next ON event_outbox(status, next_attempt_at);

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (length(scope) > 0),
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  hash TEXT NOT NULL CHECK (length(hash) > 0),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_checkpoints_project_scope ON checkpoints(project_id, scope, created_at);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  actor_id TEXT NOT NULL CHECK (length(actor_id) > 0),
  action TEXT NOT NULL CHECK (length(action) > 0),
  resource TEXT NOT NULL CHECK (length(resource) > 0),
  decision TEXT NOT NULL CHECK (decision IN ('ALLOW', 'DENY')),
  reason TEXT NOT NULL CHECK (length(reason) > 0),
  request_id TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_audit_project_decision ON audit_log(project_id, decision, created_at);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, created_at);

CREATE TABLE temporary_permissions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL CHECK (length(principal_id) > 0),
  action TEXT NOT NULL CHECK (length(action) > 0),
  resource TEXT NOT NULL CHECK (length(resource) > 0),
  effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  expires_at TEXT NOT NULL,
  granted_by TEXT NOT NULL CHECK (length(granted_by) > 0),
  created_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE INDEX idx_temp_permissions_lookup
  ON temporary_permissions(project_id, principal_id, action, resource, effect);

-- Eventos y auditoría son append-only. Los triggers impiden mutaciones.
CREATE TRIGGER events_no_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TRIGGER events_no_delete
BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TRIGGER audit_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

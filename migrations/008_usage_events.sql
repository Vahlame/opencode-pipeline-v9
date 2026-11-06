-- Uso detallado por agente, tarea, sesion y proposito.

ALTER TABLE sessions ADD COLUMN task_id TEXT;
ALTER TABLE sessions ADD COLUMN purpose TEXT;

CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL CHECK (length(purpose) > 0),
  source TEXT NOT NULL CHECK (source IN ('estimate', 'provider')),
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  cost_usd REAL NOT NULL CHECK (cost_usd >= 0),
  request_id TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_usage_events_project ON usage_events(project_id, created_at);
CREATE INDEX idx_usage_events_agent ON usage_events(project_id, agent_id);
CREATE INDEX idx_usage_events_task ON usage_events(project_id, task_id);
CREATE INDEX idx_usage_events_purpose ON usage_events(project_id, purpose);

-- Contabilidad exacta de uso reportado por el proveedor.

CREATE TABLE provider_usage (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT,
  request_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('provider', 'manual', 'import')),
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  cost_usd REAL NOT NULL CHECK (cost_usd >= 0),
  raw_json TEXT CHECK (raw_json IS NULL OR json_valid(raw_json)),
  created_at TEXT NOT NULL,
  UNIQUE (project_id, provider, request_id)
) STRICT;

CREATE INDEX idx_provider_usage_project ON provider_usage(project_id, created_at);

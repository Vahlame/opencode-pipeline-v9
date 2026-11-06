-- Firma de artefactos de integracion y entrega.

CREATE TABLE artifact_signatures (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('INTEGRATION_MANIFEST', 'FINAL_DELIVERY')),
  subject_id TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  algorithm TEXT NOT NULL CHECK (algorithm = 'HMAC-SHA256'),
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (subject_type, subject_id)
) STRICT;

CREATE INDEX idx_artifact_signatures_project ON artifact_signatures(project_id, created_at);



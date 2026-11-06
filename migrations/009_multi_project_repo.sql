-- Permite varios proyectos sobre el mismo repositorio local.
-- Cada proyecto mantiene su propio plan, tareas, worktrees y contabilidad.

DROP INDEX IF EXISTS idx_projects_repo;

CREATE INDEX idx_projects_repo ON projects(repo_path);

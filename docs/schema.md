# Esquema SQLite de la Fase 2

## Ubicación y migraciones

- Base por defecto: `.runtime/orchestrator.db` (ignorada por Git).
- Migraciones: `migrations/001_initial.sql`, `migrations/002_phase3.sql`.
- Runner: `src/persistence/database.ts`.
- Tabla de control: `schema_migrations`.
- Versión actual del esquema: **2** (Fase 3 añade `leases`, `worktrees` y `task_attempts`).

La conexión usa `node:sqlite`, `PRAGMA foreign_keys=ON`, WAL para archivos,
`busy_timeout=5000` y transacciones `BEGIN IMMEDIATE` para escrituras.

## Tablas

| Tabla                   | Propósito                          | Claves y restricciones principales                                              |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| `projects`              | Proyecto y estado global           | PK `id`; `repo_path` único; CHECK de estado                                     |
| `plans`                 | Planes versionados y hash aprobado | PK `id`; FK proyecto; único `(project_id, version)` y `(project_id, hash)`      |
| `agents`                | Agentes y rol persistido           | PK `id`; FK proyecto; único `(project_id, opencode_agent_id)`                   |
| `modules`               | Módulos y propietario              | PK `id`; FK proyecto/agente; único `(project_id, name)`                         |
| `tasks`                 | Tareas y estado                    | PK `id`; FKs proyecto/plan/módulo/agente; priority 0–100; version optimista     |
| `task_dependencies`     | DAG de tareas                      | PK `(task_id, depends_on_task_id)`; FKs; CHECK anti-auto-dependencia            |
| `contracts`             | Contratos versionados              | PK `id`; FKs tarea/módulo; único `(task_id, version)` y `(task_id, hash)`       |
| `module_versions`       | Versiones inmutables               | PK `id`; FK módulo; único `(module_id, version)` y `(module_id, artifact_hash)` |
| `sessions`              | Sesiones OpenCode planificadas     | PK `id`; FKs proyecto/agente; `opencode_session_id` único cuando existe         |
| `messages`              | Buzones persistentes               | PK `id`; FKs emisor/receptor; único `(project_id, idempotency_key)`             |
| `reviews`               | Dictámenes de jueces               | PK `id`; FK `module_version`; único `(module_version_id, judge_role)`           |
| `approvals`             | Aprobaciones humanas               | PK `id`; FK proyecto; único por sujeto/hash/aprobador                           |
| `events`                | Log durable append-only            | PK `seq` autoincremental; `id` único; triggers bloquean UPDATE/DELETE           |
| `event_outbox`          | Entrega externa con reintentos     | PK `id`; FK evento; único `(event_id, topic)`; estado/attempts                  |
| `checkpoints`           | Recuperación de estado             | PK `id`; FK proyecto; scope/hash                                                |
| `audit_log`             | Decisiones de autorización         | PK `id`; project opcional; triggers bloquean UPDATE/DELETE                      |
| `temporary_permissions` | Grants temporales                  | PK `id`; FK proyecto; efecto allow/deny; expiración/revocación                  |
| `leases`                | Lease activo por tarea             | PK `task_id`; intento, expiración y heartbeat                                   |
| `worktrees`             | Worktree Git de una tarea          | PK `id`; FK tarea/módulo; path y branch únicos; estado                          |
| `task_attempts`         | Intentos de ejecución              | PK `id`; FK tarea/sesión; único `(task_id, attempt)`; tiempos y error           |

## Relaciones principales

```text
projects
  ├── plans
  ├── agents
  │     ├── modules
  │     └── sessions
  ├── tasks ── task_dependencies
  │     ├── contracts
  │     └── messages
  ├── modules ── module_versions ── reviews
  ├── approvals
  ├── events ── event_outbox
  ├── checkpoints
  ├── audit_log
  ├── temporary_permissions
  ├── leases
  ├── worktrees ── module_versions ── reviews
  └── task_attempts ── sessions
```

## Invariantes

- Un plan aprobado tiene hash inmutable; una aprobación se vincula a ese hash.
- Una tarea no puede depender de sí misma.
- El DAG se valida con detección de ciclos en la creación de tareas.
- Una versión de módulo no se reutiliza por `artifact_hash`.
- Un juez solo puede tener un dictamen por versión de módulo.
- Un mensaje duplicado por `idempotency_key` devuelve el mismo mensaje; si cambia
  el contenido, es un conflicto.
- Cada evento durable se crea en la misma transacción que el cambio de estado y
  genera una fila de outbox.
- Los eventos y la auditoría no se pueden modificar ni borrar.
- Los mensajes son privados para su receptor; el estado compartido no los incluye.
- Los secretos se redactan por clave y por patrones `password=`, `token:`,
  `authorization:`, etc.

## Estados de tarea

```text
PENDING -> READY -> RUNNING -> IN_REVIEW -> APPROVED -> INTEGRATED
RUNNING / IN_REVIEW / READY -> PAUSED
RUNNING -> REWORK_REQUIRED -> READY
Cualquiera -> BLOCKED / FAILED / CANCELLED conforme a las guardas
```

Transiciones en `src/domain/transitions.ts`; el estado nunca se decide por el LLM.

## Eventos y outbox

- `events.seq` es la secuencia durable por base.
- Cada operación de escritura llama a `emit()` y crea evento + outbox en la misma
  transacción.
- `OutboxDispatcher` entrega con reintentos acotados; el handler debe ser
  idempotente.
- Un fallo de entrega no revierte el evento, pero queda registrado con intentos y
  `last_error` redactado.

## Autorización

`AuthorizationService` deniega por defecto y registra cada decisión en
`audit_log`. El rol efectivo de un agente se vuelve a leer de `agents`; un token
con rol manipulado se rechaza con `ROLE_STALE`.

Roles principales:

- `HUMAN`: plan, aprobaciones, inicio/pausa/cancelación de proyecto.
- `PARENT`: propuesta de planes.
- `COORDINATOR`: DAG, asignación, prioridad, pausa y contratos.
- `SPECIALIST`: progreso y escritura de su módulo.
- `JUDGE_*`: dictamen de su propio rol, sin escritura.
- `INTEGRATOR`: integración autorizada.
- `FEEDBACK`: veredicto global.

## Consultas útiles

```sql
SELECT id, name, status FROM projects;
SELECT seq, type, aggregate_type, aggregate_id FROM events ORDER BY seq DESC LIMIT 20;
SELECT actor_id, action, decision, reason FROM audit_log ORDER BY created_at DESC LIMIT 20;
SELECT id, state, priority, owner_agent_id FROM tasks WHERE project_id = ?;
SELECT id, status, event_id, attempts FROM event_outbox WHERE status = 'PENDING';
```

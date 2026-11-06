# Esquema SQLite - Fase 6

## Ubicacion y migraciones

- Base por defecto: `.runtime/orchestrator.db` (ignorada por Git).
- Migraciones: `migrations/001_initial.sql`, `002_phase3.sql`, `003_phase4.sql`,
  `004_phase5.sql`, `005_phase6.sql`, `006_phase7.sql` y
  `007_provider_usage.sql`.
- Runner: `src/persistence/database.ts`.
- Tabla de control: `schema_migrations`.
- Version actual del esquema: **7**.

La conexion usa `node:sqlite`, `PRAGMA foreign_keys=ON`, WAL para archivos,
`busy_timeout=5000` y transacciones `BEGIN IMMEDIATE` para escrituras.

## Tablas

| Tabla                   | Proposito                          | Claves y restricciones principales                                              |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| `projects`              | Proyecto y estado global           | PK `id`; `repo_path` unico; CHECK de estado                                     |
| `plans`                 | Planes versionados y hash aprobado | PK `id`; FK proyecto; unico `(project_id, version)` y `(project_id, hash)`      |
| `agents`                | Agentes y rol persistido           | PK `id`; FK proyecto; unico `(project_id, opencode_agent_id)`                   |
| `modules`               | Modulos y propietario              | PK `id`; FK proyecto/agente; unico `(project_id, name)`                         |
| `tasks`                 | Tareas y estado                    | PK `id`; FKs; priority 0-100; `review_cycle`; version optimista                 |
| `task_dependencies`     | DAG de tareas                      | PK `(task_id, depends_on_task_id)`; CHECK anti-auto-dependencia                 |
| `contracts`             | Contratos versionados              | PK `id`; FKs tarea/modulo; unico `(task_id, version)` y `(task_id, hash)`       |
| `module_versions`       | Versiones inmutables               | PK `id`; FK modulo; unico `(module_id, version)` y `(module_id, artifact_hash)` |
| `sessions`              | Sesiones OpenCode                  | PK `id`; FKs proyecto/agente; `opencode_session_id` unico cuando existe         |
| `messages`              | Buzones persistentes               | PK `id`; FKs; unico `(project_id, idempotency_key)`                             |
| `reviews`               | Dictamenes de jueces               | PK `id`; FK version; unico `(module_version_id, judge_role)`                    |
| `approvals`             | Aprobaciones humanas               | PK `id`; FK proyecto; unico por sujeto/hash/aprobador                           |
| `events`                | Log durable append-only            | PK `seq`; `id` unico; triggers bloquean UPDATE/DELETE                           |
| `event_outbox`          | Entrega externa con reintentos     | PK `id`; FK evento; unico `(event_id, topic)`                                   |
| `checkpoints`           | Recuperacion de estado             | PK `id`; FK proyecto; scope/hash                                                |
| `audit_log`             | Decisiones de autorizacion         | PK `id`; triggers bloquean UPDATE/DELETE                                        |
| `temporary_permissions` | Grants temporales                  | PK `id`; FK proyecto; efecto allow/deny; expiracion                             |
| `leases`                | Lease activo por tarea             | PK `task_id`; intento, expiracion y heartbeat                                   |
| `worktrees`             | Worktree Git de una tarea          | PK `id`; FK tarea/modulo; path y branch unicos                                  |
| `task_attempts`         | Intentos de ejecucion              | PK `id`; FK tarea/sesion; unico `(task_id, attempt)`                            |
| `jury_runs`             | Ejecucion de los cuatro jueces     | PK `id`; FK tarea/version; unico por `module_version_id`; ciclo                 |
| `jury_consolidations`   | Veredicto determinista             | PK `id`; FK run/version; unico por version                                      |
| `approved_modules`      | Registro de modulos aprobados      | PK `id`; FKs modulo/version/run; unico `(module_id, module_version_id)`         |
| `integration_runs`      | Intentos de integracion            | PK `id`; FK proyecto/plan; unico `(project, plan, input_hash, attempt)`         |
| `integration_modules`   | Versiones exactas ensambladas      | PK `id`; FKs run/modulo/version/contrato; unico `(run, module)`                 |
| `integration_adapters`  | Adaptadores versionados            | PK `id`; FK run/modulo; unico `(run, path)`; pruebas y revision JSON            |
| `integration_conflicts` | Conflictos menores/estructurales   | PK `id`; FK run; tipo, evidencia, resolucion                                    |
| `integration_manifests` | Manifiesto reproducible            | PK `id`; FK proyecto/plan/run; unico `(project, hash)` y `(run)`                |
| `feedback_runs`         | Evaluacion global                  | PK `id`; FK proyecto/plan/manifest; unico `(manifest)`                          |
| `final_deliveries`      | Entrega preparada/entregada        | PK `id`; FK proyecto/manifest/feedback; unico `(manifest)`                      |
| `project_resources`     | Tokens, coste y tiempo estimados   | PK/FK proyecto; contadores y ultimo limite                                      |
| `operations`            | Diario idempotente de operaciones  | PK `id`; unico `(project, kind, idempotency_key)`; lease y resultado            |
| `recovery_runs`         | Ejecuciones de recuperacion        | PK `id`; FK proyecto; modo, estado, hallazgos y aplicados                       |
| `recovery_actions`      | Acciones de recuperacion           | PK `id`; FK run; codigo, entidad, estado y detalle                              |
| `artifact_signatures`   | Firmas HMAC de manifiesto/entrega  | PK `id`; unico `(subject_type, subject_id)`; hash y firma                       |
| `provider_usage`        | Uso exacto reportado por proveedor | PK `id`; FK proyecto; tokens, coste, request ID y fuente                        |

## Relaciones principales

```text
projects
  +-- plans
  +-- agents
  |     +-- modules
  |     +-- sessions
  +-- tasks +-- task_dependencies
  |     +-- contracts
  |     +-- messages
  +-- modules +-- module_versions +-- reviews
  +-- approvals
  +-- events +-- event_outbox
  +-- checkpoints
  +-- audit_log
  +-- temporary_permissions
  +-- leases
  +-- worktrees
  +-- task_attempts +-- sessions
  +-- jury_runs +-- jury_consolidations
  +-- approved_modules
  +-- integration_runs
  |     +-- integration_modules
  |     +-- integration_adapters
  |     +-- integration_conflicts
  |     +-- integration_manifests
  +-- feedback_runs
  +-- final_deliveries
  +-- project_resources
  +-- operations
  +-- recovery_runs +-- recovery_actions
  +-- artifact_signatures
  +-- provider_usage
```

## Invariantes

- Un plan aprobado tiene hash inmutable; una aprobacion se vincula a ese hash.
- Una tarea no puede depender de si misma; el DAG se valida con deteccion de ciclos.
- Una version de modulo no se reutiliza por `artifact_hash`.
- Un juez solo puede tener un dictamen por version de modulo.
- Un mensaje duplicado por `idempotency_key` devuelve el mismo mensaje; si cambia
  el contenido, es un conflicto.
- Cada evento durable se crea en la misma transaccion que el cambio de estado y
  genera una fila de outbox.
- Los eventos y la auditoria no se pueden modificar ni borrar.
- Los mensajes son privados para su receptor; el estado compartido no los incluye.
- Los secretos se redactan por clave y por patrones `password=`, `token:`,
  `authorization:`, etc.
- Solo se integran versiones con `approved_modules` cuyo commit, tree y artifact
  siguen coincidiendo con la version inmutable.
- Un manifiesto se vincula a un input hash, plan, commit base y commit de
  integracion.
- Un adaptador solo puede escribir bajo `integration/adapters/` y no puede
  modificar modulos aprobados.
- Un fallo estructural no crea manifiesto.
- Un `FAIL` de feedback no crea entrega final.
- Una entrega final solo pasa a `DELIVERED` con feedback `PASS` y aprobacion
  humana.
- Una operacion idempotente no se ejecuta dos veces si su lease sigue vigente.
- Un lease vencido puede tomarse una sola vez como reintento.
- Un worktree sucio nunca se elimina automaticamente.
- Un proyecto terminal no se muta por recuperacion; solo se diagnostica o se
  limpian worktrees limpios.
- El control de recursos pausa el proyecto y registra el limite alcanzado.

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
- Cada operacion de escritura llama a `emit()` y crea evento + outbox en la misma
  transaccion.
- `OutboxDispatcher` entrega con reintentos acotados; el handler debe ser
  idempotente.
- Un fallo de entrega no revierte el evento, pero queda registrado con intentos y
  `last_error` redactado.

## Autorizacion

`AuthorizationService` deniega por defecto y registra cada decision en
`audit_log`. El rol efectivo de un agente se vuelve a leer de `agents`; un token
con rol manipulado se rechaza con `ROLE_STALE`.

Roles principales:

- `HUMAN`: plan, aprobaciones, inicio/pausa/cancelacion de proyecto, finalizacion
  de entrega.
- `PARENT`: propuesta de planes y recepcion de entrega final.
- `COORDINATOR`: DAG, asignacion, prioridad, pausa y contratos.
- `SPECIALIST`: progreso y escritura de su modulo.
- `JUDGE_*`: dictamen de su propio rol, sin escritura.
- `INTEGRATOR`: integracion autorizada.
- `FEEDBACK`: veredicto global.

## Consultas utiles

```sql
SELECT id, name, status FROM projects;
SELECT seq, type, aggregate_type, aggregate_id FROM events ORDER BY seq DESC LIMIT 20;
SELECT actor_id, action, decision, reason FROM audit_log ORDER BY created_at DESC LIMIT 20;
SELECT id, state, priority, owner_agent_id FROM tasks WHERE project_id = ?;
SELECT id, status, event_id, attempts FROM event_outbox WHERE status = 'PENDING';
SELECT id, status, input_hash, manifest_hash FROM integration_runs WHERE project_id = ?;
SELECT id, verdict, manifest_id FROM feedback_runs WHERE project_id = ?;
SELECT id, status, manifest_id FROM final_deliveries WHERE project_id = ?;
```

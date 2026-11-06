# Fase 6 - Recuperacion, robustez, recursos, observabilidad y entrega

## Objetivo

Cerrar la implementacion inicial con recuperacion tras reinicios, idempotencia,
limites de recursos, observabilidad CLI y una operacion extremo a extremo
auditada. Esta fase no declara el sistema listo para produccion.

## Implementado

### RecoveryManager

`src/recovery/manager.ts` reconcilia:

- sesiones OpenCode ausentes, fallidas o stale;
- leases expirados y tareas RUNNING sin lease;
- tareas RUNNING abandonadas;
- tareas PENDING que ya pueden liberarse;
- tareas REWORK_REQUIRED sustituidas por una version posterior;
- worktrees missing, abandonados o sucios;
- jurados RUNNING interrumpidos;
- integraciones y feedback RUNNING interrumpidos;
- mensajes QUEUED y outbox pendiente;
- operaciones con lease vencido;
- aprobaciones cuyo commit o artifact ya no coincide;
- proyectos en etapas incompletas;
- tareas pendientes despues de completar el proyecto.

Cada ejecucion crea `recovery_runs` y `recovery_actions`. En modo `APPLY` solo
aplica acciones seguras; los worktrees sucios y las decisiones humanas quedan
como `REQUIRED`. En `DRY_RUN` o `diagnostics` no modifica estado operativo.

### Idempotencia y concurrencia

- `operations` con clave unica `(project_id, kind, idempotency_key)`.
- `OperationService` devuelve resultados completados, bloquea operaciones con
  lease vigente y toma leases vencidos con incremento de intento.
- Leases renovables y recuperacion de tareas abandonadas.
- Claims transaccionales del scheduler y proteccion contra doble asignacion.
- Mensajes con `idempotency_key`.
- Transiciones con version optimista.
- `BEGIN IMMEDIATE` y rollback probado.
- Integraciones y feedback conservan sus claves, manifiestos y resultados.

### Control de recursos

Variables:

| Variable                        | Limite                       |
| ------------------------------- | ---------------------------- |
| `ORCH_MAX_AGENTS`               | Agentes concurrentes maximos |
| `ORCH_MAX_PARALLEL`             | Tareas concurrentes maximas  |
| `ORCH_TASK_MAX_ATTEMPTS`        | Intentos por tarea           |
| `ORCH_MAX_REWORK_CYCLES`        | Ciclos de jurado/rework      |
| `ORCH_MAX_INTEGRATION_ATTEMPTS` | Ciclos de integracion        |
| `ORCH_SESSION_TIMEOUT_MS`       | Tiempo por tarea/sesion      |
| `ORCH_PROJECT_MAX_MINUTES`      | Tiempo total de proyecto     |
| `ORCH_MAX_PROJECT_TOKENS`       | Tokens estimados             |
| `ORCH_MAX_PROJECT_COST_USD`     | Coste estimado               |
| `ORCH_INPUT_COST_PER_MILLION`   | Tarifa de entrada            |
| `ORCH_OUTPUT_COST_PER_MILLION`  | Tarifa de salida             |
| `ORCH_OPERATION_LEASE_SECONDS`  | Lease de operaciones         |
| `ORCH_RECOVERY_STALE_MINUTES`   | Umbral de sesiones stale     |
| `ORCH_WORKTREE_RETENTION_DAYS`  | Retencion de limpieza        |

`ResourceGovernor` estima tokens por longitud de texto, calcula coste estimado,
persiste `project_resources`, pausa el proyecto al superar un limite y registra
`resource.limit_reached`. La estimacion no sustituye la contabilidad exacta del
proveedor.

### Observabilidad CLI

- `status --project <id> [--json]`: estado completo legible o JSON.
- `usage --project <id>`: tokens, coste, tiempo y limites.
- `diagnostics --project <id>`: hallazgos de recuperacion sin aplicar.
- `recovery:run --project <id> [--apply] [--json]`.
- `recovery:history --project <id>`.
- `maintenance:cleanup --project <id> [--keep-days N] [--apply]`.
- `delivery:export --delivery <id> --output <file>`.
- Comandos existentes para proyecto, plan, tareas, agentes, eventos, mensajes,
  revisiones, jurado, integraciones y estados.

La entrega final legible se exporto a `docs/entrega-final.md`.

### Recuperacion al inicio

`serve` ejecuta recuperacion `APPLY` sobre proyectos no terminales cuando
`ORCH_RECOVERY_ON_START=1`. La recuperacion es idempotente por estado persistido.
Los proyectos terminales no se mutan; `diagnostics` sigue disponible.

### Mantenimiento de worktrees

`WorktreeMaintenance`:

- solo considera worktrees/snapshots limpios;
- respeta la retencion configurada;
- nunca toca worktrees sucios;
- conserva ramas y commits;
- marca el worktree de base de datos como `REMOVED`;
- ejecuta `git worktree prune`.

## Demostracion real de recuperacion

Se uso una base aislada `.runtime/phase6-recovery.db` para no alterar el
proyecto final. El escenario se creo con:

```text
project: prj_108492767eef412a9f8747f11ce465b9
plan: pln_5133ca63ff9f4ee1a045485836262af6
task: tsk_293e581a2a584e6886322d092f032939
attempt: att_0c2e45f573c840d1856b84b8aba86e61
session: ses_ddff11d74a8c482288b2545db0a766ff
integration run: irn_58bfd8bd17824b3db7977668c60a8704
operation: opr_984be3830c6c495d94016cf8941a11ac
```

Estado antes del reinicio:

```text
project: INTEGRATING
task: RUNNING
integration: RUNNING
operation: RUNNING
queued messages: 1
```

Se ejecuto `recovery:run --apply` en un proceso nuevo:

```text
recovery: rcv_d82e1cc7393e47ba9669668363add9df
mode: APPLY
findings: 6
applied: 4
actions:
  SESSION_MISSING_IN_OPENCODE -> APPLIED
  LEASE_EXPIRED -> APPLIED
  INTEGRATION_RUN_INTERRUPTED -> APPLIED
  OPERATION_LEASE_EXPIRED -> APPLIED
  MESSAGES_PENDING -> SKIPPED (requiere sesion/entrega)
  OUTBOX_PENDING -> SKIPPED
```

Estado despues:

```text
project: RUNNING
task: READY
attempts: 1
attempt: INTERRUPTED
session: STOPPED
integration: FAILED
operation: FAILED
tasks duplicadas: 0
attempts duplicados: 0
commits nuevos: 0
queued messages: 2 (original + informe de recuperacion)
```

Una segunda recuperacion produjo `rcv_cd0b16cb22e54952ba5af2b23231d88b` con
2 hallazgos y 0 aplicados. Una tercera reutilizo la misma recuperacion:

```text
reused: true
```

### Modulos aprobados intactos

La prueba `tests/integration/phase6-recovery.test.ts` integra dos modulos
aprobados, ejecuta recuperacion y verifica que:

- `approved_modules` no cambia;
- el manifiesto y los commits de integracion no cambian;
- los modulos aprobados siguen `INTEGRATED`;
- no se crea un nuevo intento de integracion.

## Limpieza aplicada

Se ejecuto `maintenance:cleanup --keep-days 0 --apply` sobre el proyecto final:

```text
worktrees de tarea eliminados: 3
snapshots de jurado/feedback/integracion eliminados: 10
worktrees sucios eliminados: 0
commits eliminados: 0
worktree de demostracion bad-demo eliminado
```

`git worktree list` quedo solo con el repositorio principal. Los commits siguen
siendo legibles (`git cat-file -t a024fc0732a85a2e3f2ade89717ddf516556a356`
devuelve `commit`) y la evidencia permanece en SQLite y en
`docs/entrega-final.md`.

## Recorrido extremo a extremo

El proyecto real `Phase 3 Demo` acumula el recorrido de las fases 1-5 y la
auditoria de la fase 6:

| Paso                          | Evidencia                                                                 |
| ----------------------------- | ------------------------------------------------------------------------- |
| Humano solicita aplicacion    | Proyecto creado por humano y plan aprobado                                |
| Padre genera plan             | `pln_b5d5bc1ea17e44a5b3acd4353aed5790`, propuesto por padre               |
| Humano aprueba                | `approvedBy=human`, `approvedAt=2026-11-06T15:34:34.172Z`                 |
| Coordinador crea DAG          | Tareas y `task_dependencies`                                              |
| Dos especialistas en paralelo | Sesiones y commits `85e245a...`, `24fc2f1...`                             |
| Memoria compartida            | El prompt de tarea incluye estado de tareas/modulos sin mensajes privados |
| Mensajes con permisos         | `audit_log` y rechazo de mensajes no autorizados                          |
| Cuatro jueces                 | 12 dictamenes reales, consolidaciones deterministas                       |
| Rechazo y correccion          | Frontend v2 rechazada; rework y frontend v3 aprobada                      |
| Integrador                    | Manifest `imn_d99a37b10bbc445287e93f56292dca8d`                           |
| Incompatibilidad menor        | Adaptador `integration/adapters/frontend-sum.mjs@v1`                      |
| Pruebas E2E                   | 3/3 PASS y adapter test PASS                                              |
| Feedback global               | `fbr_0524686c7c8e4c008f9007cce1e060fe` PASS                               |
| Entrega al humano             | `fdl_9b1e702aca434493872e7d6e20dc6794` DELIVERED                          |

La entrega legible esta en `docs/entrega-final.md`. No existe una notificacion
pop-up: el aviso al padre es un mensaje persistido y la entrega se consulta con
`status`, `delivery:show` o `delivery:export`.

### Agente matematico

Se agrego el perfil `matematico` como especialista dedicado:

- formaliza problemas y restricciones;
- busca papers, surveys y documentacion tecnica con `webfetch`/`websearch`;
- compara enfoques y sintetiza teorias;
- deriva ecuaciones y valida dimensiones/casos limite;
- estima complejidad, memoria y encaje en CPU/GPU;
- escribe solo en `modules/math/**` y `research/math/**`;
- no tiene shell, subagentes ni acceso a secretos.

El permiso web solo se habilita para este agente. Los demas especialistas,
jueces y feedback mantienen `webfetch`/`websearch` denegados. La skill
`math-research` documenta la metodologia y exige citas verificables, separacion
entre teorema/aproximacion/conjetura y validacion numerica.

Prueba real ejecutada:

```text
agente: matematico
modelo: opencode-go/deepseek-v4.1-flash
sesion: ses_e4dc8f2fdffe1B4tPLLu4vKst4
prompt: buscar un paper reciente sobre GEMM en GPU y devolver JSON verificable
resultado: KAMI: Communication-Avoiding General Matrix Multiplication within a Single GPU
DOI: https://doi.org/10.1145/3712285.3759895
verificacion: websearch + webfetch del DOI; no se citaron speedups no reproducidos
```

El agente no invento la fuente, verifico el DOI y separo la evidencia de las
cifras no reproducidas.

## Extension de endurecimiento operativo

### GUI local

`GET /ui` sirve una Control Room sin framework externo con:

- estado del proyecto y tareas;
- aprobacion de plan;
- feedback y dictamenes;
- integraciones y manifiestos;
- recuperacion con diagnostico y confirmacion;
- entrega final con confirmacion humana;
- recursos, mensajes y outbox;
- tokens exactos por subagente, tarea y proposito.

La GUI usa el mismo API y token humano; no crea una segunda fuente de verdad.

### Herramientas OpenCode

`.opencode/plugins/orchestrator-tools.js` expone al agente:

- `orchestrator_state`;
- `orchestrator_inbox`;
- `orchestrator_send`;
- `orchestrator_delivery`;
- `orchestrator_math_run`.

Las llamadas usan `ORCH_TOOL_SECRET` y el API local; el agente no recibe el
token humano. El plugin requiere reiniciar el servidor OpenCode para cargarse.

### Agente UI/UX

Se agrego `disenador` con permisos de lectura, web de referencia y edicion solo
en `ui/**` y `docs/ui/**`. La skill `ui-ux-review` define el checklist. Una
revision real detecto y se corrigieron:

- confirmacion contextual antes de aplicar recuperacion;
- estados de carga/actualizacion y anuncios `aria-live`;
- labels accesibles y foco visible en controles.

### Ejecucion matematica

`math:run` detecta CPU, memoria e interprete recomendado y ejecuta scripts
Python o Node dentro del repositorio. Prueba real:

```text
hardware: AMD Ryzen 7 7840HS, 16 cores, 15.3 GB
interprete: python 3.14.7
resultado: PASS en 69 ms
```

El agente `matematico` puede usar `orchestrator_math_run` a traves del plugin.

### Outbox y uso exacto

- `outbox:dispatch --transport file` entrego **116 eventos** a
  `.runtime/outbox.ndjson`; la outbox quedo en 0 pendientes.
- `usage:record` importa uso exacto del proveedor (tokens, coste y request ID).
  La estimacion local sigue existiendo para cuando OpenCode no entrega datos.
- `usage:sync` lee los mensajes de OpenCode y registra tokens/coste exactos por
  mensaje. Es idempotente y recupera proposito/tarea en sesiones antiguas desde
  el titulo. `in` incluye cache read/write; `out` incluye reasoning.
- `usage_events` registra uso por agente, tarea, sesion y proposito.
  `usage:breakdown --by agent|task|session|purpose` muestra el desglose.
- `math:run` ejecuta scripts con Python o Node detectando hardware.

### Firmas

`artifact_signatures` firma manifiestos y entregas con HMAC-SHA256. La entrega
real se firmo y `delivery:verify` respondio:

```text
Firma valida: entrega autentica.
```

### Reconciliacion legacy

`legacy:reconcile --task <id> --decision cancel|requeue --confirm` exige humano,
confirmacion explicita, auditoria y permite operar sobre proyectos terminales.
`diagnostics` sigue reportando las tareas legacy sin mutarlas.

## Manual de uso

### Instalacion

```powershell
npm install
Copy-Item .env.example .env
# Editar ORCH_AUTH_SECRET y confirmar OPENCODE_MODEL
npm run db:migrate
npm run doctor
```

Modelo actual: `opencode-go/deepseek-v4.1-flash`, con `capabilities.tools=true`.
Servidor: se mantiene el servidor V2 de la app para desarrollo; un servidor
dedicado es la recomendacion para produccion.

### Iniciar API con recuperacion

```powershell
npm run serve
```

### Crear y aprobar un proyecto

```powershell
$HUMAN = npx tsx src/cli.ts auth:issue --kind HUMAN --subject human
$PARENT = npx tsx src/cli.ts auth:issue --kind AGENT --agent <parent-agent-id>
npx tsx src/cli.ts project:create --name "Demo" --repo "$PWD" --token $HUMAN
npx tsx src/cli.ts project:bootstrap --project <project-id> --token $HUMAN
npx tsx src/cli.ts plan:propose --project <project-id> --title "Plan" --spec '{"objective":"..."}' --token $PARENT
npx tsx src/cli.ts plan:approve --plan <plan-id> --hash <plan-hash> --token $HUMAN
npx tsx src/cli.ts project:start --project <project-id> --token $HUMAN
```

### Ejecutar agentes en paralelo

```powershell
npx tsx src/cli.ts scheduler:run --project <project-id> --max-parallel 2 --token $HUMAN
npx tsx src/cli.ts status --project <project-id> --token $HUMAN
```

El scheduler respeta `ORCH_MAX_PARALLEL` y `ORCH_MAX_AGENTS`, leases, intentos y
presupuesto. Para pausar o reanudar:

```powershell
npx tsx src/cli.ts project:pause --project <project-id> --token $HUMAN
npx tsx src/cli.ts project:resume --project <project-id> --token $HUMAN
```

### Jurado, integracion y feedback

```powershell
npx tsx src/cli.ts jury:run --task <task-id> --token $HUMAN
npx tsx src/cli.ts integration:run --input request.json --token $INTEGRATOR
npx tsx src/cli.ts feedback:run --manifest <manifest-id> --token $FEEDBACK
npx tsx src/cli.ts delivery:export --delivery <delivery-id> --output docs/entrega.md --token $HUMAN
```

### Recuperacion y mantenimiento

```powershell
npx tsx src/cli.ts diagnostics --project <project-id> --token $HUMAN
npx tsx src/cli.ts recovery:run --project <project-id> --apply --token $HUMAN
npx tsx src/cli.ts maintenance:cleanup --project <project-id> --keep-days 7 --token $HUMAN
```

`maintenance:cleanup` es dry-run sin `--apply`.

## Pruebas

| Prueba                              | Evidencia                                   |
| ----------------------------------- | ------------------------------------------- |
| Interrupcion de sesion y lease      | `tests/integration/recovery.test.ts`        |
| Integracion interrumpida            | `tests/integration/recovery.test.ts`        |
| Recuperacion idempotente            | `tests/integration/recovery.test.ts`        |
| Tarea superseded                    | `tests/integration/recovery.test.ts`        |
| Modulos aprobados intactos          | `tests/integration/phase6-recovery.test.ts` |
| Limpieza segura                     | `tests/integration/maintenance.test.ts`     |
| Leases de operacion y deduplicacion | `tests/unit/operations.test.ts`             |
| Limites y pausa de recursos         | `tests/unit/resources.test.ts`              |
| Doble claim                         | `tests/integration/scheduler.test.ts`       |
| Rollback y append-only              | `tests/integration/persistence.test.ts`     |

## Auditoria final

| Area             | Resultado                                                                           |
| ---------------- | ----------------------------------------------------------------------------------- |
| Arquitectura     | Modulos separados por dominio; `OpenCodeAdapter` como frontera                      |
| Seguridad        | Denegacion por defecto, worktrees, rutas canonicas, sin shell de agente             |
| Permisos         | Tokens HMAC, rol revalidado en DB, auditoria de cada decision                       |
| Contratos        | Zod, transiciones centralizadas, hashes de contrato                                 |
| Integridad       | Eventos/outbox transaccionales, append-only, FKs y CHECK                            |
| Concurrencia     | `BEGIN IMMEDIATE`, version optimista, leases, claims unicos                         |
| Recuperacion     | Sesiones, leases, tareas, worktrees, jurados, integraciones, feedback y operaciones |
| Recursos         | Limites configurables y pausa por presupuesto                                       |
| Reproducibilidad | Input hash, commit determinista, manifiesto y reuso idempotente                     |
| Pruebas          | Ver resultados en el reporte final                                                  |

## Verificacion final

```text
npm run check       -> 103 pruebas pasan, 2 omitidas
npm run build       -> pasa
npm run db:migrate  -> esquema 8
npm run test:real   -> 1 prueba real pasa
npm run test:sdk    -> 1 prueba SDK pasa
npm run doctor      -> fase 6, OpenCode V2.2.5, 13 perfiles
```

## Limitaciones conocidas

- La GUI local ya existe, pero no tiene TLS ni autenticacion de red. No exponerla
  a Internet.
- El plugin de herramientas ya existe; requiere reiniciar el servidor OpenCode y
  `ORCH_TOOL_SECRET` en el entorno.
- `npm run check` no se ejecuta dentro del workspace de integracion porque los
  worktrees no incluyen `node_modules` y los modulos aprobados inmutables no
  deben reformatearse sin nueva aprobacion. Se ejecuta en el repositorio.
- La contabilidad importa el usage exacto que reporta OpenCode por mensaje; si
  un proveedor no lo reporta, se usa la estimacion local.
- La outbox tiene transporte por archivo y webhook; falta endurecer
  autenticacion, reintentos y garantia exactly-once.
- Quedan tareas historicas: la tarea original del frontend superseded y la tarea
  dependiente PENDING. `diagnostics` las reporta; no se mutan en un proyecto
  COMPLETED por la guarda terminal.
- El adaptador real por agente existe con `--agent-adapter`, pero la demo uso
  una especificacion explicita y el test automatizado cubre la ruta asistida.
- No se declara listo para produccion: falta evaluacion de seguridad de red,
  aislamiento de SO y prueba en una VM Windows limpia.

## Pendientes actuales

1. Probar el instalador en una VM Windows completamente limpia.
2. Sandbox de SO por worktree si se habilita shell o codigo no confiable.
3. Servidor V2 dedicado y TLS si la GUI deja de ser local.
4. Endurecer webhook, reintentos y autenticacion de eventos.
5. Revision de seguridad y de las vulnerabilidades transitivas del SDK.
6. Demo real del adaptador por agente con `--agent-adapter`.
7. Sandbox de SO por worktree.
8. Politica de retencion y firma de artefactos.
9. Reconciliacion automatica de tareas historicas con aprobacion humana.

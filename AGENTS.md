# Instrucciones del proyecto

## Contexto

Este repositorio implementa las fases 1, 2, 3, 4, 5 y 6 de **OpenCode Multiagent
Orchestrator V9** sobre OpenCode V2. La Fase 1 aporta la base y la conexion real;
la Fase 2 aporta SQLite, autorizacion, mensajeria, eventos durables y outbox; la
Fase 3 aporta scheduler DAG, worktrees Git, sesiones reales, ejecucion paralela y
leases; la Fase 4 aporta jurado independiente, consolidacion determinista, rework
y registro de modulos aprobados; la Fase 5 aporta integracion hibrida,
adaptadores, manifiesto reproducible, feedback global y entrega final; la Fase 6
aporta recuperacion tras reinicios, idempotencia, control de recursos,
observabilidad CLI y auditoria operativa.

## Comandos de verificacion

Antes de declarar terminado un cambio:

```powershell
npm run check
npm run build
npm run db:migrate
```

Para comprobar la conexion real con OpenCode V2:

```powershell
npm run doctor
npm run smoke
```

No ejecutes `npm run test:real` en CI ni sin intencion explicita: consume tokens.

## Arquitectura

- `src/domain/`: tipos, esquemas Zod, IDs y transiciones.
- `src/opencode/`: interfaz `OpenCodeAdapter`, runtime HTTP, SDK y mock.
- `src/config/`: variables de entorno y validacion.
- `src/cli.ts`, `src/cli/phase2.ts` ... `src/cli/phase5.ts`: comandos locales.
- `src/persistence/`: SQLite, migraciones y repositorios.
- `src/auth/`: tokens HMAC y autorizacion.
- `src/orchestrator/`: servicios de planes, tareas, mensajes y estado.
- `src/api/`: API HTTP interna local.
- `src/outbox/`: entrega de eventos con reintentos.
- `src/worktrees/`: aislamiento Git, validacion de rutas y commits deterministas.
- `src/sessions/`: sesiones OpenCode, prompts, espera e interrupcion.
- `src/orchestrator/scheduler.ts`, `task-executor.ts`: DAG, leases y ejecucion real.
- `src/jury/`: jueces, consolidacion determinista y rework.
- `src/integration/`: `IntegrationManager`, workspace Git, manifiesto,
  `FeedbackService`, `DeliveryService` y agentes de feedback.
- `src/recovery/`: `RecoveryManager`, reconciliacion y mantenimiento de worktrees.
- `src/resources/`: `ResourceGovernor`, estimacion de tokens/coste y limites.
- `src/operations/`: diario idempotente de operaciones con leases.
- `.worktrees/`: worktrees de tareas, integraciones y snapshots, ignorados por Git.
- `.opencode/agents/`: perfiles V2 en Markdown.
- `.opencode/skills/`: instrucciones compartidas.
- `docs/`: decisiones, alcance y esquema.

No importes `@opencode/client` ni `@opencode/sdk` fuera de `src/opencode/`. El resto
del sistema debe depender de `OpenCodeAdapter`.

## Persistencia y autorizacion

- Toda mutacion de estado debe generar evento y outbox en la misma transaccion.
- Usa `BEGIN IMMEDIATE`; no anides transacciones.
- Los eventos y `audit_log` son append-only.
- No confies en roles declarados en prompts o mensajes; usa `AuthorizationService`.
- Los mensajes son privados para su receptor; no los incluyas en el estado
  compartido.
- No registres secretos en payloads, eventos, logs ni respuestas.
- Los tokens se emiten con `auth:issue` solo desde el entorno administrativo; no
  los incluyas en prompts ni repositorio.
- `ORCH_AUTH_SECRET` es local y nunca debe versionarse.
- Los agentes no tienen shell; los tests y commits los ejecuta el orquestador.
- Un worktree por tarea; nunca compartas un directorio de escritura.
- El scheduler solo ejecuta con plan aprobado y proyecto `RUNNING`.
- `ORCH_AGENT_MODEL` debe tener `capabilities.tools=true`.
- No borres worktrees sucios sin autorizacion humana.
- Los jueces son de solo lectura; no pueden editar, ejecutar shell ni cambiar
  contratos.
- Un dictamen ausente no es aprobacion; el consolidador es determinista.
- Una aprobacion se vincula a la version y al commit; no se hereda a versiones
  nuevas.
- `ORCH_MAX_REWORK_CYCLES` limita los ciclos de correccion.

## Integracion y feedback

- Solo se integran versiones registradas en `approved_modules`, con commit, tree
  y artifact hash vigentes.
- El integrador no puede modificar modulos aprobados ni hacer merges destructivos.
- Los adaptadores viven bajo `integration/adapters/`, se prueban y se registran
  con version, commit, hash y revision.
- Una incompatibilidad estructural genera un informe al coordinador y no crea
  manifiesto.
- El manifiesto incluye plan, commit base, modulos, contratos, adaptadores,
  pruebas, conflictos y hashes reproducibles.
- Un fallo de integracion no crea entrega final.
- `FeedbackService` es de solo lectura sobre el snapshot integrado.
- Un criterio obligatorio `PASS` sin evidencia no autoriza la entrega.
- Un feedback ausente, invalido o `FAIL` no crea entrega final.
- La entrega final solo pasa a `DELIVERED` con feedback `PASS` y aprobacion
  humana.
- El padre no puede declarar finalizado el proyecto sin aprobacion global y
  evidencia.
- `ORCH_INTEGRATION_TIMEOUT_MS` y `ORCH_FEEDBACK_TIMEOUT_MS` limitan las
  operaciones.

## Recuperacion, recursos y operacion

- `RecoveryManager` nunca convierte un intento en una operacion completada.
- Los leases vencidos y las tareas RUNNING sin lease se reintentan solo dentro
  del limite de intentos; si no, se marcan FAILED.
- Un worktree sucio no se borra ni se modifica automaticamente.
- La limpieza solo elimina worktrees/snapshots limpios dentro de la retencion y
  nunca borra ramas ni commits.
- Las operaciones usan `operations` con clave idempotente y lease.
- `ResourceGovernor` pausa el proyecto al superar tiempo, tokens o coste
  estimado cuando el proyecto esta `RUNNING`.
- `ORCH_MAX_AGENTS` y `ORCH_MAX_PARALLEL` limitan la concurrencia.
- `serve` ejecuta recuperacion al iniciar si `ORCH_RECOVERY_ON_START=1`.
- `diagnostics` es de solo lectura operativa; `recovery:run --apply` aplica
  cambios seguros.
- La outbox pendiente no se elimina sin transporte o decision humana.
- No se declara produccion sin evaluacion de seguridad de red, sandbox de SO,
  presupuesto y GUI.

## OpenCode V2

- Usa `agents`, `permissions` y `policies`; no uses campos V1 como `permission`,
  `bash`, `task`, `temperature` o `maxSteps`.
- Los perfiles son `mode: primary` porque el orquestador los lanza como sesiones
  independientes.
- No agregues subagentes ni shell libre a los agentes.
- No modifiques la configuracion global de OpenCode ni la instalacion V1.
- La app de OpenCode Desktop usa V2.2.5; el `opencode` del `PATH` puede ser V1.

## Seguridad

- La autorizacion efectiva pertenece al orquestador, no al prompt.
- Denegacion por defecto.
- Sin shell, sin `.env`, sin `.git`, sin rutas externas y sin escritura fuera del
  modulo asignado.
- No incluyas secretos en eventos, logs, mensajes, pruebas ni documentacion.
- No hagas pushes, despliegues, borrados irreversibles ni cambios de credenciales
  sin autorizacion humana.
- Los adaptadores no pueden ocultar errores estructurales ni alterar la logica de
  los modulos aprobados.

## Formato de trabajo

- Cambios pequenos y verificables.
- Pruebas unitarias e integracion con mocks para CI.
- La prueba real con OpenCode es opt-in.
- No afirmes que una prueba paso si no la ejecutaste.
- Documenta supuestos y limitaciones.

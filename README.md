# OpenCode Multiagent Orchestrator V9

Orquestador multiagente sobre **OpenCode V2** con fases 1 a 6 implementadas:
conexion real, persistencia SQLite, autorizacion, scheduler DAG con worktrees,
jurado independiente, integracion hibrida, feedback global, recuperacion y
operacion observable.

## Estado actual

- Fase 1: base, adaptador, perfiles y smoke real con OpenCode.
- Fase 2: SQLite, migraciones, autorizacion, mensajes, eventos/outbox, API y CLI.
- Fase 3: scheduler DAG, worktrees Git, sesiones reales, ejecucion paralela y leases.
- Fase 4: cuatro jueces independientes, consolidacion determinista, rework y
  registro de modulos aprobados.
- Fase 5: `IntegrationManager`, adaptadores versionados, manifiesto reproducible,
  feedback global y entrega final con aprobacion humana.
- Fase 6: `RecoveryManager`, idempotencia, control de recursos, observabilidad CLI,
  mantenimiento de worktrees y auditoria operativa.
- Agente `matematico`: investigacion de papers, formalizacion, ecuaciones,
  validacion numerica y optimizacion para hardware.
- Modelo actual: `opencode-go/deepseek-v4.1-flash`.
- Runtime interactivo: `HttpOpenCodeAdapter` contra el servidor OpenCode V2 de la app.
- Runtime CI/headless: `SdkOpenCodeAdapter`; pruebas: `MockOpenCodeAdapter`.
- Persistencia local en `.runtime/orchestrator.db` (esquema **8**).
- Entrega final legible: `docs/entrega-final.md`.

## Requisitos

- Node.js **26.13.0** o superior (minimo del proyecto: 26.4.0).
- npm 11.x.
- Git.
- OpenCode **V2.2.5** para la prueba real. La app de OpenCode Desktop ya incluye
  un CLI V2; el `opencode` del `PATH` puede ser V1.

> Este proyecto no migra ni modifica la instalacion V1. La prueba real usa el
> servidor V2 de la app o un servidor V2 dedicado, nunca el `opencode` V1.

## Instalacion

```powershell
npm install
Copy-Item .env.example .env
# Editar ORCH_AUTH_SECRET y confirmar OPENCODE_MODEL
npm run db:migrate
npm run doctor
```

El modelo por defecto es `opencode-go/deepseek-v4.1-flash`, con soporte de
herramientas. Los costes estimados se configuran con
`ORCH_INPUT_COST_PER_MILLION` y `ORCH_OUTPUT_COST_PER_MILLION`.

Para fijar el runtime sin depender del Node global:

```powershell
. .\scripts\setup-node.ps1
```

## Verificacion

```powershell
npm run check
npm run build
npm run db:migrate
npm run doctor
npm run test:real
npm run test:sdk
```

No ejecutes `test:real` en CI sin intencion explicita: consume tokens.

## Comandos principales

### Proyecto, plan y ejecucion

```powershell
npx tsx src/cli.ts project:create --name "Demo" --repo "$PWD" --token $HUMAN
npx tsx src/cli.ts project:bootstrap --project <id> --token $HUMAN
npx tsx src/cli.ts plan:propose --project <id> --title "Plan" --spec '{"objective":"..."}' --token $PARENT
npx tsx src/cli.ts plan:approve --plan <id> --hash <hash> --token $HUMAN
npx tsx src/cli.ts project:start --project <id> --token $HUMAN
npx tsx src/cli.ts scheduler:run --project <id> --max-parallel 2 --token $HUMAN
npx tsx src/cli.ts project:pause --project <id> --token $HUMAN
npx tsx src/cli.ts project:resume --project <id> --token $HUMAN
```

El scheduler respeta `ORCH_MAX_PARALLEL`, `ORCH_MAX_AGENTS`, leases, intentos,
tiempos y presupuesto estimado.

### Observabilidad

```powershell
npx tsx src/cli.ts status --project <id> --token $HUMAN
npx tsx src/cli.ts status --project <id> --json --token $HUMAN
npx tsx src/cli.ts usage --project <id> --token $HUMAN
npx tsx src/cli.ts diagnostics --project <id> --token $HUMAN
npx tsx src/cli.ts recovery:run --project <id> --apply --token $HUMAN
npx tsx src/cli.ts recovery:history --project <id> --token $HUMAN
npx tsx src/cli.ts maintenance:cleanup --project <id> --keep-days 7 --token $HUMAN
npx tsx src/cli.ts maintenance:cleanup --project <id> --keep-days 7 --apply --token $HUMAN
```

`serve` ejecuta recuperacion al arrancar si `ORCH_RECOVERY_ON_START=1`. La
recuperacion nunca confunde un intento con una operacion completada.

### Jurado, integracion y feedback

```powershell
npx tsx src/cli.ts jury:run --task <id> --token $HUMAN
npx tsx src/cli.ts jury:runs --project <id> --token $HUMAN
npx tsx src/cli.ts integration:run --input request.json --token $INTEGRATOR
npx tsx src/cli.ts integration:run --input request.json --agent-adapter --token $INTEGRATOR
npx tsx src/cli.ts integration:manifests --project <id> --token $HUMAN
npx tsx src/cli.ts feedback:run --manifest <id> --token $FEEDBACK
npx tsx src/cli.ts deliveries:list --project <id> --token $HUMAN
npx tsx src/cli.ts delivery:show --delivery <id> --token $HUMAN
npx tsx src/cli.ts delivery:export --delivery <id> --output docs/entrega.md --token $HUMAN
npx tsx src/cli.ts delivery:finalize --delivery <id> --token $HUMAN
```

La entrega final solo pasa a `DELIVERED` con feedback `PASS` y aprobacion humana.
La notificacion al padre es un mensaje persistido, no un pop-up; el artefacto
legible se consulta en `docs/entrega-final.md` o con `delivery:export`.

## API interna

```powershell
npm run serve
```

Expone endpoints locales como `/api/state`, `/api/agents`, `/api/tasks`,
`/api/events`, `/api/messages`, `/api/jury/*`, `/api/integrations`,
`/api/feedback`, `/api/deliveries` y `POST /api/deliveries/<id>/finalize`,
protegidos con Bearer token. Enlaza a `127.0.0.1` por defecto, sin TLS; es una API
local, no un servicio publico.

## GUI local y herramientas

Con `npm run serve`, abre:

```text
http://127.0.0.1:4400/ui
```

La Control Room permite cargar un proyecto con token, aprobar plan, ver feedback,
diagnosticar/aplicar recuperacion, consultar integraciones y finalizar entregas.

El plugin `.opencode/plugins/orchestrator-tools.js` expone al agente estado,
inbox, envio de mensajes, entrega y `orchestrator_math_run`. Requiere
`ORCH_TOOL_SECRET` y reiniciar OpenCode.

Operacion adicional:

```powershell
npx tsx src/cli.ts outbox:dispatch --project <id> --transport file --target .runtime/outbox.ndjson --token $HUMAN
npx tsx src/cli.ts delivery:verify --delivery <id> --token $HUMAN
npx tsx src/cli.ts usage:record --project <id> --provider opencode-go --input <n> --output <n> --cost <usd> --token $HUMAN
npx tsx src/cli.ts math:run --project <id> --script research/math/check.py --token $HUMAN
npx tsx src/cli.ts legacy:reconcile --task <id> --decision cancel --confirm --token $HUMAN
```

## Recuperacion y recursos

- `RecoveryManager`: sesiones, leases, tareas, worktrees, jurados, integraciones,
  feedback, mensajes, outbox y operaciones parciales.
- `OperationService`: claves idempotentes, leases, resultados durables y reintento
  de operaciones vencidas.
- `ResourceGovernor`: agentes/tareas concurrentes, intentos, ciclos, tiempo,
  tokens y coste estimado; pausa y registra el motivo.
- `WorktreeMaintenance`: dry-run por defecto, retencion, solo worktrees limpios y
  conservacion de commits/ramas.
- `status`, `usage`, `diagnostics`, `recovery:*` y `delivery:export` para operar
  sin GUI.

## Perfiles

| Perfil         | Rol                                               |
| -------------- | ------------------------------------------------- |
| `padre`        | Especificacion, plan y comunicacion con el humano |
| `coordinador`  | DAG, asignaciones y contratos                     |
| `frontend`     | Especialista frontend                             |
| `backend`      | Especialista backend                              |
| `database`     | Especialista de persistencia                      |
| `matematico`   | Investigacion matematica, papers y optimizacion   |
| `disenador`    | Auditoria UI/UX, accesibilidad y refinamiento     |
| `testing`      | Juez obligatorio de pruebas                       |
| `debugger`     | Juez obligatorio de depuracion                    |
| `architecture` | Juez obligatorio de arquitectura                  |
| `optimizer`    | Juez de optimizacion; solo bloquea `CRITICAL`     |
| `integrador`   | Ensamblado y adaptadores                          |
| `feedback`     | Veredicto global y entrega final                  |

Los perfiles usan el formato V2: `agents`, `permissions`, acciones `shell`/`edit`
y reglas ordenadas. No se usan campos V1 como `permission`, `bash` o `maxSteps`.

## Seguridad

- Denegacion por defecto en la configuracion y en `AuthorizationService`.
- Sin shell libre para agentes fuera del agente de desarrollo `build`.
- Sin edicion fuera de las rutas autorizadas.
- Sin `.env`, `.git` ni acceso a directorios externos.
- Sin subagentes, web ni skills no autorizadas.
- Identidad HMAC; rol del agente revalidado en SQLite.
- Mensajes privados por receptor; estado compartido sin mensajes.
- Eventos y auditoria append-only; secretos redactados.
- Los adaptadores no pueden editar modulos aprobados.
- La API es local y no debe exponerse a Internet sin autenticacion de red y TLS.

## Documentacion

- `docs/architecture.md`: decisiones y limites.
- `docs/phase-1.md` a `docs/phase-6.md`: alcance y evidencias por fase.
- `docs/entrega-final.md`: entrega final legible.
- `docs/ui-review.md`: revision UI/UX y hallazgos corregidos.\n- `docs/install-virgin.md`: instalacion en Windows/OpenCode limpio.
- `docs/schema.md`: esquema SQLite, relaciones e invariantes.
- `docs/opencode-v2.md`: notas de integracion V2.
- `AGENTS.md`: instrucciones persistentes para agentes.

## Resultado de la Fase 6

```text
npm run check       -> 100 pruebas pasan, 2 omitidas
npm run build       -> pasa
npm run db:migrate  -> esquema 8
npm run test:real   -> 1 prueba real pasa
npm run test:sdk    -> 1 prueba SDK pasa
```

La recuperacion real se demostro en una base aislada: sesion ausente, lease
vencido, integracion interrumpida y operacion vencida se reconciliaron sin
duplicar tareas, intentos ni commits. Los worktrees limpios se retiraron y los
commits se conservaron. Los detalles estan en `docs/phase-6.md`.

## Limitaciones

- La GUI avanzada queda fuera del alcance; se usa CLI/API.
- No hay plugin de herramientas de agente; el estado compartido se inyecta en el
  prompt.
- `npm run check` no se ejecuta dentro del workspace de integracion porque no
  incluye `node_modules` y los modulos aprobados inmutables no deben reformatearse
  sin nueva aprobacion.
- La estimacion de tokens/coste es aproximada.
- La outbox no tiene transporte externo configurado; los eventos quedan durables.
- No se declara listo para produccion sin evaluacion de seguridad, sandbox de SO,
  presupuesto real y GUI.

## Futuro V10

Panel GUI, plugin de herramientas, servidor dedicado, contabilidad exacta de
tokens/coste, transporte de outbox, sandbox por worktree y firma de artefactos.

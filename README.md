# OpenCode Multiagent Orchestrator V9

Orquestador multiagente sobre **OpenCode V2** con fases 1 a 5 implementadas:
conexion real, persistencia SQLite, autorizacion, scheduler DAG con worktrees,
jurado independiente, integracion hibrida, feedback global y entrega final.

## Estado actual

- Fase 1: base, adaptador, perfiles y smoke real con OpenCode.
- Fase 2: SQLite, migraciones, autorizacion, mensajes, eventos/outbox, API y CLI.
- Fase 3: scheduler DAG, worktrees Git, sesiones reales, ejecucion paralela y leases.
- Fase 4: cuatro jueces independientes, consolidacion determinista, rework y
  registro de modulos aprobados.
- Fase 5: `IntegrationManager`, adaptadores versionados, manifiesto reproducible,
  feedback global y entrega final con aprobacion humana.
- Runtime interactivo: `HttpOpenCodeAdapter` contra un servidor OpenCode V2.
- Runtime CI/headless: `SdkOpenCodeAdapter` con host embebido y datos aislados.
- Runtime de pruebas: `MockOpenCodeAdapter`.
- Persistencia local en `.runtime/orchestrator.db`.
- Worktrees y snapshots en `.worktrees/`, ignorados por Git.
- Evidencia de integracion en `integration_runs`, `integration_modules`,
  `integration_adapters`, `integration_conflicts`, `integration_manifests`.
- Feedback y entrega en `feedback_runs` y `final_deliveries`.

## Requisitos

- Node.js **26.13.0** o superior (minimo del proyecto: 26.4.0).
- npm 11.x.
- Git.
- OpenCode **V2.2.5** para la prueba real. La app de OpenCode Desktop ya incluye
  un CLI V2; el `opencode` del `PATH` puede ser V1.

> Importante: este proyecto no migra ni modifica la instalacion V1 existente. La
> prueba real usa el servidor V2 de la app o un servidor V2 dedicado, nunca el
> `opencode` V1 del `PATH`.

Para fijar el runtime del proyecto sin depender del global:

```powershell
. .\scripts\setup-node.ps1
```

## Instalacion

```powershell
npm install
Copy-Item .env.example .env
```

Edita `.env` y genera un secreto local para `ORCH_AUTH_SECRET` (minimo 16
caracteres). El modelo debe tener `capabilities.tools=true`. El `.env` local de
verificacion usa `opencode/deepseek-v4.1-flash-free` como fallback.

## Comandos

```powershell
npm run check
npm run build
npm run db:migrate
npm run doctor
npm run agents
npm run smoke
npm run test:real
npm run test:sdk
npm run serve
.\scripts\phase2-demo.ps1
.\scripts\phase3-demo.ps1 -Reset
```

### `doctor`

Comprueba el entorno, la conexion con OpenCode V2, los perfiles, las habilidades
y el estado de la base. En Fase 5 reporta tambien integraciones, manifiestos,
feedback y entregas.

```powershell
npm run doctor
```

### `smoke`

Crea una sesion real, envia un prompt minimo y recupera la respuesta.

```powershell
npm run smoke
npm run smoke -- --agent padre --prompt "Responde unicamente OK" --json
npm run smoke -- --keep
```

### Prueba real

```powershell
npm run test:real
npm run test:sdk
```

`test:real` consume tokens del proveedor configurado. No lo ejecutes en CI sin
intencion explicita.

## Identidad

Los comandos que consultan o modifican estado requieren un token firmado. El
comando de emision es una operacion de administrador local y usa
`ORCH_AUTH_SECRET`:

```powershell
npx tsx src/cli.ts auth:issue --kind HUMAN --subject human
npx tsx src/cli.ts auth:issue --kind AGENT --agent <agent-id>
```

El token se imprime una vez; no debe incluirse en prompts, logs ni repositorio.
Alternativamente, usa `ORCH_TOKEN`.

## Flujo basico

```powershell
npx tsx src/cli.ts project:create --name "Demo" --repo "$PWD" --token $HUMAN
npx tsx src/cli.ts project:bootstrap --project <id> --token $HUMAN
npx tsx src/cli.ts plan:propose --project <id> --title "Plan" --spec '{"objective":"..."}' --token $PARENT
npx tsx src/cli.ts plan:approve --plan <id> --hash <hash> --token $HUMAN
npx tsx src/cli.ts project:start --project <id> --token $HUMAN
npx tsx src/cli.ts state --project <id> --token $AGENT
npx tsx src/cli.ts events --project <id> --token $AGENT
npx tsx src/cli.ts rejected --project <id> --token $HUMAN
```

## Fases 3 y 4

```powershell
npx tsx src/cli.ts scheduler:run --project <id> --token $HUMAN
npx tsx src/cli.ts sessions:list --project <id> --token $HUMAN
npx tsx src/cli.ts worktrees:list --project <id> --token $HUMAN
npx tsx src/cli.ts attempts:list --project <id> --token $HUMAN
npx tsx src/cli.ts jury:run --task <id> --token $HUMAN
npx tsx src/cli.ts jury:runs --project <id> --token $HUMAN
npx tsx src/cli.ts jury:consolidations --project <id> --token $HUMAN
npx tsx src/cli.ts jury:approved --project <id> --token $HUMAN
```

## Fase 5: integracion y feedback

La integracion usa un manifiesto JSON. Ejemplo de flujo:

```powershell
npx tsx src/cli.ts integration:run --input .runtime/phase5-request.json --token $INTEGRATOR
npx tsx src/cli.ts integration:run --input .runtime/phase5-request.json --agent-adapter --token $INTEGRATOR
npx tsx src/cli.ts integration:runs --project <id> --token $HUMAN
npx tsx src/cli.ts integration:manifests --project <id> --token $HUMAN
npx tsx src/cli.ts integration:show --manifest <id> --token $HUMAN
npx tsx src/cli.ts feedback:run --manifest <id> --token $FEEDBACK
npx tsx src/cli.ts feedback:runs --project <id> --token $HUMAN
npx tsx src/cli.ts deliveries:list --project <id> --token $HUMAN
npx tsx src/cli.ts delivery:show --delivery <id> --token $HUMAN
npx tsx src/cli.ts delivery:finalize --delivery <id> --token $HUMAN
```

Reglas principales:

- Solo se integran versiones con `approved_modules` y commit/artifact vigentes.
- Una incompatibilidad menor puede resolverse con un adaptador bajo
  `integration/adapters/`, probado y versionado.
- Una incompatibilidad estructural se reporta al coordinador y no crea manifiesto.
- El feedback exige evidencia por criterio y no puede aprobar un requisito
  incumplido.
- La entrega final queda `READY` con feedback `PASS`; solo un humano la pasa a
  `DELIVERED` y completa el proyecto.

## API interna

```powershell
npm run serve
```

Expone endpoints locales como `/api/state`, `/api/agents`, `/api/tasks`,
`/api/contracts`, `/api/events`, `/api/messages`, `/api/audit`,
`/api/rejected`, `/api/outbox`, `/api/jury/*`, `/api/integrations`,
`/api/integrations/manifests`, `/api/feedback`, `/api/deliveries` y
`POST /api/deliveries/<id>/finalize`, protegidos con Bearer token. Enlaza a
`127.0.0.1` por defecto, sin TLS; es una API local, no un servicio publico.

## Runtime

| Runtime | Uso                                                    | Datos                            |
| ------- | ------------------------------------------------------ | -------------------------------- |
| `http`  | Interactivo; la app puede conectarse al mismo servidor | Servidor V2 existente o dedicado |
| `sdk`   | CI/headless, sin puerto                                | Directorio temporal aislado      |
| `mock`  | Tests unitarios/CI                                     | Memoria                          |

El nucleo solo depende de `OpenCodeAdapter`; no importa el SDK ni el cliente HTTP
directamente.

## Perfiles

| Perfil         | Rol                                               |
| -------------- | ------------------------------------------------- |
| `padre`        | Especificacion, plan y comunicacion con el humano |
| `coordinador`  | DAG, asignaciones y contratos                     |
| `frontend`     | Especialista frontend                             |
| `backend`      | Especialista backend                              |
| `database`     | Especialista de persistencia                      |
| `testing`      | Juez obligatorio de pruebas                       |
| `debugger`     | Juez obligatorio de depuracion                    |
| `architecture` | Juez obligatorio de arquitectura                  |
| `optimizer`    | Juez de optimizacion; solo bloquea `CRITICAL`     |
| `integrador`   | Ensamblado y adaptadores                          |
| `feedback`     | Veredicto global y entrega final                  |

Los perfiles usan el formato V2: `agents`, `permissions`, acciones `shell`/`edit`
y reglas ordenadas. No se usan campos V1 como `permission`, `bash` o `maxSteps`.

## Seguridad

- Denegacion por defecto en la configuracion del proyecto y en
  `AuthorizationService`.
- Sin shell libre para agentes fuera del agente de desarrollo `build`.
- Sin edicion fuera de las rutas autorizadas.
- Sin `.env`, `.git` ni acceso a directorios externos.
- Sin subagentes, web ni skills no autorizadas.
- Identidad firmada HMAC; el rol del agente se revalida en SQLite.
- Mensajes privados por receptor; el estado compartido no los expone.
- Eventos y auditoria append-only; secretos redactados.
- Los adaptadores no pueden editar modulos aprobados.
- La API es local y no debe exponerse a Internet sin autenticacion de red y TLS.

## Documentacion

- `docs/architecture.md`: decisiones y limites.
- `docs/phase-1.md`: alcance y verificaciones de la Fase 1.
- `docs/phase-2.md`: nucleo persistente.
- `docs/phase-3.md`: scheduler, worktrees y ejecucion real.
- `docs/phase-4.md`: jurado, consolidacion y rework.
- `docs/phase-5.md`: integracion, feedback y entrega final.
- `docs/schema.md`: esquema SQLite, relaciones e invariantes.
- `docs/opencode-v2.md`: notas de integracion V2.
- `AGENTS.md`: instrucciones persistentes para agentes.

## Verificacion de la Fase 5

```text
npm run check       -> 82 pruebas pasan, 2 omitidas
npm run build       -> pasa
npm run db:migrate  -> esquema 4
npm run test:real   -> pasa
npm run test:sdk    -> pasa
```

La demostracion real dejo un manifiesto reproducible, un adaptador validado, un
fallo estructural reportado al coordinador, un feedback real `PASS`, una entrega
`DELIVERED` y el proyecto `COMPLETED`. Los detalles y hashes estan en
`docs/phase-5.md`.

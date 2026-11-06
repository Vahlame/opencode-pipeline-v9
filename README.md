# OpenCode Multiagent Orchestrator V9

Este repositorio contiene el núcleo de un orquestador multiagente sobre **OpenCode V2**. La Fase 1 establece la base técnica, los perfiles de agente y la conexión real con OpenCode. La Fase 2 añade la fuente oficial de verdad persistente: SQLite, autorización, mensajería, eventos durables y outbox. Todavía **no** implementa el scheduler completo, worktrees reales, jurado consolidado, integración final ni feedback.

## Estado actual

- Fase 1: base, adaptador, perfiles y smoke real con OpenCode.
- Fase 2: SQLite, migraciones, autorización, mensajes, eventos/outbox, API y CLI.
- Fase 3: scheduler DAG, worktrees Git, sesiones reales, ejecución paralela, leases y commits.
- Fase 4: cuatro jueces independientes, consolidación determinista, rework limitado y registro de módulos aprobados.
- Runtime interactivo: `HttpOpenCodeAdapter` contra un servidor OpenCode V2.
- Runtime CI/headless: `SdkOpenCodeAdapter` con host embebido y datos aislados.
- Runtime de pruebas: `MockOpenCodeAdapter`.
- Dominio tipado con Zod y transiciones centralizadas.
- Perfiles V2 en `.opencode/agents/` y habilidades en `.opencode/skills/`.
- Persistencia local en `.runtime/orchestrator.db`.
- Worktrees en `.worktrees/` y evidencia en `sessions`, `worktrees` y `task_attempts`.
- Jurado real y consolidación en `reviews`, `jury_runs`, `jury_consolidations` y `approved_modules`.
- Sin integración final ni feedback todavía.

## Requisitos

- Node.js **26.13.0** o superior (mínimo del proyecto: 26.4.0).
- npm 11.x.
- Git.
- OpenCode **V2.2.5** para la prueba real. La app de OpenCode Desktop ya incluye un CLI V2; el `opencode` del `PATH` puede ser V1.
- No se requiere Bun.

> Importante: este proyecto no migra ni modifica la instalación V1 existente. La prueba real usa el servidor V2 de la app o un servidor V2 dedicado, nunca el `opencode` V1 del `PATH`.

La instalación global fue actualizada a Node 26.13.0. Para fijar el runtime del proyecto sin depender del global:

```powershell
. .\scripts\setup-node.ps1
```

El script descarga Node 26.13.0, verifica SHA256 y lo deja en `.tools/`.

## Instalación

```powershell
npm install
Copy-Item .env.example .env
```

Edita `.env` y genera un secreto local para `ORCH_AUTH_SECRET` (mínimo 16
caracteres). El `.env` local del repositorio de verificación ya apunta a
`opencode/deepseek-v4.1-flash-free`, un modelo con soporte de herramientas. Si
tienes otro proveedor, cambia `OPENCODE_MODEL` o pásalo con `--model`. No uses un
modelo sin `capabilities.tools` para tareas de agente.

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

Comprueba la conexión con OpenCode V2, lista los agentes reconocidos y verifica que existan los perfiles y habilidades esperados.

```powershell
npm run doctor
```

### `agents`

Lista los agentes que OpenCode reconoce para este proyecto.

```powershell
npm run agents
```

### `smoke`

Crea una sesión real, envía un prompt mínimo y recupera la respuesta. Por defecto elimina la sesión al terminar.

```powershell
npm run smoke
npm run smoke -- --agent padre --prompt "Responde únicamente OK" --json
npm run smoke -- --keep
```

Si no se configura `OPENCODE_BASE_URL`, el adaptador descubre el servidor V2 local registrado por OpenCode. No se registra la contraseña.

### Prueba real

```powershell
npm run test:real
```

Equivale a `OPENCODE_REAL_TESTS=1` y ejecuta el test de integración real. Consume tokens del proveedor configurado.

## Fase 2: núcleo persistente

### Base de datos

```powershell
npm run db:migrate
```

Crea `.runtime/orchestrator.db` y aplica `migrations/001_initial.sql`. El esquema
está documentado en `docs/schema.md`.

### Identidad

Los comandos que consultan o modifican estado requieren un token firmado. El
comando de emisión es una operación de administrador local y usa
`ORCH_AUTH_SECRET`:

```powershell
npx tsx src/cli.ts auth:issue --kind HUMAN --subject human
npx tsx src/cli.ts auth:issue --kind AGENT --agent <agent-id>
```

El token se imprime una vez; no debe incluirse en prompts, logs ni repositorio.
Alternativamente, usa `ORCH_TOKEN`.

### Flujo básico

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

La demo completa y reproducible está en `scripts/phase2-demo.ps1`.

### Fase 3: ejecución real

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

La demo completa está en `scripts/phase3-demo.ps1` y crea dos worktrees
independientes, dos sesiones OpenCode, dos commits y una tarea dependiente que
permanece bloqueada. Por defecto usa el servidor V2 de la app y el modelo
`opencode/deepseek-v4.1-flash-free` como fallback; configura
`ORCH_AGENT_MODEL` para otro modelo con `capabilities.tools=true`.

### API interna

```powershell
npm run serve
```

Expone endpoints locales como `/api/state`, `/api/agents`, `/api/tasks`,
`/api/contracts`, `/api/events`, `/api/messages`, `/api/audit`,
`/api/rejected` y `/api/outbox`, protegidos con Bearer token. Enlaza a
`127.0.0.1` por defecto, sin TLS; es una API local, no un servicio público.

## Runtime

| Runtime | Uso                                                    | Datos                            |
| ------- | ------------------------------------------------------ | -------------------------------- |
| `http`  | Interactivo; la app puede conectarse al mismo servidor | Servidor V2 existente o dedicado |
| `sdk`   | CI/headless, sin puerto                                | Directorio temporal aislado      |
| `mock`  | Tests unitarios/CI                                     | Memoria                          |

El núcleo solo depende de `OpenCodeAdapter`; no importa el SDK ni el cliente HTTP directamente.

## Perfiles

| Perfil         | Rol                                               |
| -------------- | ------------------------------------------------- |
| `padre`        | Especificación, plan y comunicación con el humano |
| `coordinador`  | DAG, asignaciones y contratos                     |
| `frontend`     | Especialista frontend                             |
| `backend`      | Especialista backend                              |
| `database`     | Especialista de persistencia                      |
| `testing`      | Juez obligatorio de pruebas                       |
| `debugger`     | Juez obligatorio de depuración                    |
| `architecture` | Juez obligatorio de arquitectura                  |
| `optimizer`    | Juez de optimización; solo bloquea `CRITICAL`     |
| `integrador`   | Ensamblado y adaptadores                          |
| `feedback`     | Veredicto global y entrega final                  |

Los perfiles usan el formato V2: `agents`, `permissions`, acciones `shell`/`edit` y reglas ordenadas. No se usan campos V1 como `permission`, `bash` o `maxSteps`.

`padre` es el agente por defecto y es de solo lectura. Para editar el proyecto
manualmente desde la app, selecciona el agente `build`; su override de desarrollo
permite edición, shell y skills sin debilitar los perfiles del orquestador.

## Seguridad

- Denegación por defecto en la configuración del proyecto y en `AuthorizationService`.
- Sin shell libre para agentes fuera del agente de desarrollo `build`.
- Sin edición fuera de las rutas autorizadas.
- Sin `.env`, `.git` ni acceso a directorios externos.
- Sin subagentes, web ni skills no autorizadas.
- Identidad firmada HMAC; el rol del agente se revalida en SQLite.
- Mensajes privados por receptor; el estado compartido no los expone.
- Eventos y auditoría append-only; secretos redactados.
- La API es local y no debe exponerse a Internet sin autenticación de red y TLS.

## Documentación

- `docs/architecture.md`: decisiones y límites.
- `docs/phase-1.md`: alcance y verificaciones de la Fase 1.
- `docs/phase-2.md`: alcance, resultados, pruebas y pendientes de la Fase 2.
- `docs/phase-3.md`: scheduler, worktrees, ejecución real y evidencias.
- `docs/phase-4.md`: jurado, consolidación, rework y evidencias.
- `docs/schema.md`: esquema SQLite, relaciones e invariantes.
- `docs/opencode-v2.md`: notas de integración V2.
- `AGENTS.md`: instrucciones persistentes para agentes.

## Próximas fases

La Fase 5 incorporará la integración de los módulos aprobados, adaptadores,
feedback global y la entrega final. La Fase 4 deja módulos aprobados en
`approved_modules`; no se avanza automáticamente sin verificar la fase.

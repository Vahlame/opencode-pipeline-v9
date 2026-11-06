# Instrucciones del proyecto

## Contexto

Este repositorio implementa las fases 1, 2 y 3 de **OpenCode Multiagent Orchestrator V9** sobre OpenCode V2. La Fase 1 aporta la base y la conexión real; la Fase 2 aporta SQLite, autorización, mensajería, eventos durables y outbox; la Fase 3 aporta scheduler DAG, worktrees Git, sesiones reales, ejecución paralela y leases. El jurado, la integración y el feedback completos pertenecen a fases posteriores.

## Comandos de verificación

Antes de declarar terminado un cambio:

```powershell
npm run check
npm run build
npm run db:migrate
```

Para comprobar la conexión real con OpenCode V2:

```powershell
npm run doctor
npm run smoke
```

No ejecutes `npm run test:real` en CI ni sin intención explícita: consume tokens.

## Arquitectura

- `src/domain/`: tipos, esquemas Zod, IDs y transiciones.
- `src/opencode/`: interfaz `OpenCodeAdapter`, runtime HTTP, SDK y mock.
- `src/config/`: variables de entorno y validación.
- `src/cli.ts`, `src/cli/phase2.ts`: comandos locales.
- `src/persistence/`: SQLite, migraciones y repositorios.
- `src/auth/`: tokens HMAC y autorización.
- `src/orchestrator/`: servicios de planes, tareas, mensajes y estado.
- `src/api/`: API HTTP interna local.
- `src/outbox/`: entrega de eventos con reintentos.
- `src/worktrees/`: aislamiento Git, validación de rutas y commits.
- `src/sessions/`: sesiones OpenCode, prompts, espera e interrupción.
- `src/orchestrator/scheduler.ts`, `task-executor.ts`: DAG, leases y ejecución real.
- `.worktrees/`: worktrees de demostración, ignorados por Git.
- `.opencode/agents/`: perfiles V2 en Markdown.
- `.opencode/skills/`: instrucciones compartidas.
- `docs/`: decisiones, alcance y esquema.

No importes `@opencode/client` ni `@opencode/sdk` fuera de `src/opencode/`. El resto del sistema debe depender de `OpenCodeAdapter`.

## Persistencia y autorización

- Toda mutación de estado debe generar evento y outbox en la misma transacción.
- Usa `BEGIN IMMEDIATE`; no anides transacciones.
- Los eventos y `audit_log` son append-only.
- No confíes en roles declarados en prompts o mensajes; usa `AuthorizationService`.
- Los mensajes son privados para su receptor; no los incluyas en el estado compartido.
- No registres secretos en payloads, eventos, logs ni respuestas.
- Los tokens se emiten con `auth:issue` solo desde el entorno administrativo; no
  los incluyas en prompts ni repositorio.
- `ORCH_AUTH_SECRET` es local y nunca debe versionarse.
- Los agentes no tienen shell; los tests y commits los ejecuta el orquestador.
- Un worktree por tarea; nunca compartas un directorio de escritura.
- El scheduler solo ejecuta con plan aprobado y proyecto `RUNNING`.
- `ORCH_AGENT_MODEL` debe tener `capabilities.tools=true`.
- No borres worktrees sucios sin autorización humana.

## OpenCode V2

- Usa `agents`, `permissions` y `policies`; no uses campos V1 como `permission`, `bash`, `task`, `temperature` o `maxSteps`.
- Los perfiles son `mode: primary` porque el orquestador los lanza como sesiones independientes.
- No agregues subagentes ni shell libre a los agentes.
- No modifiques la configuración global de OpenCode ni la instalación V1.
- La app de OpenCode Desktop usa V2.2.5; el `opencode` del `PATH` puede ser V1.

## Seguridad

- La autorización efectiva pertenece al orquestador, no al prompt.
- Denegación por defecto.
- Sin shell, sin `.env`, sin `.git`, sin rutas externas y sin escritura fuera del módulo asignado.
- No incluyas secretos en eventos, logs, mensajes, pruebas ni documentación.
- No hagas pushes, despliegues, borrados irreversibles ni cambios de credenciales sin autorización humana.

## Formato de trabajo

- Cambios pequeños y verificables.
- Pruebas unitarias e integración con mocks para CI.
- La prueba real con OpenCode es opt-in.
- No afirmes que una prueba pasó si no la ejecutaste.
- Documenta supuestos y limitaciones.

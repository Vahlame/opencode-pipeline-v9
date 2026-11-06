# Fase 2 — Núcleo persistente, autorización, mensajes y eventos

## Objetivo

Convertir el orquestador en una fuente de verdad durable: proyectos, planes,
agentes, tareas, dependencias, contratos, módulos, sesiones, mensajes, revisiones,
aprobaciones, eventos, checkpoints y auditoría.

## Implementado

- SQLite con migraciones versionadas y `node:sqlite`.
- 17 tablas del núcleo más outbox y permisos temporales.
- Transacciones `BEGIN IMMEDIATE` y rollback probado.
- Identidad firmada HMAC-SHA256 (`TokenService`).
- `AuthorizationService` deny-by-default con rol, recurso, propietario, estado y
  permisos temporales.
- Revalidación del rol del agente contra la base de datos.
- Estado operativo compartido sin mensajes privados ni secretos.
- Buzones persistentes con correlación, prioridad, estados, ack e idempotencia.
- Mensajes `INFO`, `QUERY`, `ORDER`, `PAUSE`, `CANCEL`; los de control requieren
  coordinador o humano.
- Entrega en punto seguro para mensajes ordinarios.
- Evento durable + outbox en la misma transacción.
- Triggers append-only para eventos y auditoría.
- `OutboxDispatcher` con reintentos y límite de intentos.
- API HTTP local con Bearer token.
- CLI con operaciones de proyecto, plan, tarea, módulo, contrato, revisión,
  aprobación, mensajes, eventos, auditoría y outbox.
- Redacción de secretos en payloads y logs.
- Demo CLI reproducible en `scripts/phase2-demo.ps1`.

## Comandos

```powershell
npm run db:migrate
npm run check
npm run build
npm run test:real
npm run test:sdk
npm run serve
.\scripts\phase2-demo.ps1
```

## Emisión de tokens

`auth:issue` es una operación de administrador local que usa `ORCH_AUTH_SECRET`.
No debe exponerse por la API ni ejecutarse desde una sesión de agente.

```powershell
npx tsx src/cli.ts auth:issue --kind HUMAN --subject human
npx tsx src/cli.ts auth:issue --kind AGENT --agent <agent-id>
```

El token se imprime en stdout; no se debe copiar a logs, prompts ni repositorios.
El `ORCH_TOKEN` del entorno es la alternativa para el CLI.

## Resultados verificados

Comandos ejecutados con Node **26.13.0**:

| Comando                     | Resultado                                                             |
| --------------------------- | --------------------------------------------------------------------- |
| `npm run db:migrate`        | Esquema 1; tablas creadas                                             |
| `npm run check`             | Formato, typecheck y lint pasan; **55 pruebas pasan**, 2 omitidas     |
| `npm run build`             | Pasa                                                                  |
| `npm run test:real`         | 1 prueba real de OpenCode pasa                                        |
| `npm run test:sdk`          | 1 prueba del host SDK pasa                                            |
| `npm run doctor`            | OpenCode V2.2.5; 11 perfiles; DB y esquema disponibles                |
| `.\scripts\phase2-demo.ps1` | Flujo real completo con 11 agentes, plan, tarea, mensaje y denegación |

Resumen real de la demo:

```json
{
  "agents": 11,
  "planHash": "b36aee8b22b3",
  "taskState": "READY",
  "duplicateReturnedSameMessage": true,
  "unauthorizedOrderDenied": true,
  "rejectedOperations": 1,
  "events": 19,
  "modules": 1
}
```

Ejemplo real de operación rechazada:

```json
{
  "action": "message.send",
  "resource": "message:*:prj_...",
  "decision": "DENY",
  "reason": "COORDINATOR_REQUIRED_FOR_CONTROL_MESSAGE"
}
```

## Pruebas de aceptación

1. Todos los agentes ven el estado compartido: `tests/integration/state.test.ts`.
2. Un especialista no puede reasignar: `tests/integration/authorization.test.ts`.
3. Un agente no envía órdenes no autorizadas: `tests/integration/messaging.test.ts`.
4. El coordinador puede asignar/priorizar/pausar: `authorization.test.ts`.
5. Un mensaje duplicado no duplica acciones: `messaging.test.ts`.
6. Una operación fallida no deja registros: `failures.test.ts` y `persistence.test.ts`.
7. Las modificaciones generan eventos auditables: `persistence.test.ts` y `state.test.ts`.
8. Los secretos no aparecen en estado/logs: `state.test.ts`, `tokens-redaction.test.ts` y `api.test.ts`.

## Decisiones

- Node actualizado a **26.13.0** globalmente y fijado localmente con `scripts/setup-node.ps1`; `@opentui/core` ya no advierte por motor.
- SQLite `node:sqlite` para evitar módulos nativos en Windows.
- Un único escritor lógico y transacciones `BEGIN IMMEDIATE`.
- HMAC para identidad; el rol del agente se revalida en DB.
- Mensajes privados por receptor; el estado compartido no los incluye.
- El estado `PAUSED` se añadió a las tareas porque el coordinador debe pausar.
- La entrega real de mensajes a sesiones OpenCode queda para la Fase 3; en esta
  fase se persiste y se entrega en punto seguro lógico.
- La API es local, sin TLS, pensada para `127.0.0.1`.
- El outbox se entrega con un handler inyectable; la Fase 3 conectará el
  transporte real.

## Pendientes y bloqueos para la Fase 3

- Falta el plugin de herramientas OpenCode para que la identidad del agente sea
  el `sessionID` real y no un token CLI.
- Falta integrar sesiones y worktrees reales con el scheduler.
- Falta ejecutar mensajes `PAUSE`/`CANCEL` sobre sesiones activas preservando estado.
- Falta decidir si se usará el servidor V2 de la app o un servidor dedicado.
- Falta elegir modelo con `capabilities.tools=true` y presupuesto por rol.
- Falta definir la raíz de worktrees y el repositorio objetivo.
- Falta endurecer la recuperación de leases y la reconciliación de sesiones.
- Falta un mecanismo de revocación explícita de permisos temporales.
- Falta transporte real para el outbox y observabilidad de reintentos.
- La redacción es defensiva, pero debe añadirse un escaneo de logs en CI.

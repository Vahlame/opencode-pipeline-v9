# Fase 1 — Base, perfiles y conexión real

## Objetivo

Preparar el proyecto TypeScript modular, los perfiles de agente V2 y una integración real y sustituible con OpenCode.

## Alcance implementado

- Proyecto npm con TypeScript estricto, ESLint, Prettier y Vitest.
- Validación de entorno con Zod.
- Interfaz `OpenCodeAdapter`.
- `HttpOpenCodeAdapter` contra un servidor V2.
- `SdkOpenCodeAdapter` con host embebido aislado.
- `MockOpenCodeAdapter` determinista.
- Tipos y esquemas para Project, Plan, Agent, Task, Module, Contract, Event, Message, Review y Approval.
- Transiciones de estado centralizadas.
- 11 perfiles V2 en `.opencode/agents/`.
- 4 skills compartidas.
- CLI `doctor`, `agents` y `smoke`.
- Pruebas unitarias e integración con mocks.
- Prueba real opt-in.

## Fuera de alcance

- Scheduler completo.
- Base de datos SQLite del orquestador.
- Eventos durables y outbox.
- Leases, heartbeats y recuperación.
- Jurado y consolidación.
- Integración final y feedback.
- Worktrees gestionados por el orquestador.
- Autenticación por sesión/plugin.

## Verificaciones

Las verificaciones reales de esta implementación se registran al ejecutar:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run doctor
npm run smoke
```

No se debe declarar una prueba como pasada sin haberla ejecutado.

## Decisiones

- HTTP es el runtime interactivo para que la app de OpenCode pueda observar sesiones.
- El SDK queda para CI/headless.
- El mock es obligatorio para tests deterministas.
- La autorización efectiva se implementará en el orquestador; los permisos de OpenCode son defensa en profundidad.
- Se usa `node:sqlite` en la Fase 2 para evitar dependencias nativas en Windows.

## Resultados verificados (2026-11-06)

Comandos ejecutados y resultado real:

| Comando                                    | Resultado                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `npm run typecheck`                        | Pasa                                                                               |
| `npm run lint`                             | Pasa                                                                               |
| `npm run format:check`                     | Pasa                                                                               |
| `npm test`                                 | 6 archivos pasan, 2 omitidos; 21 pruebas pasan, 2 omitidas                         |
| `npm run build`                            | Pasa                                                                               |
| `npm run doctor`                           | Adaptador HTTP V2.2.5 OK; 11 perfiles y 4 skills; `expectedAgentsRecognized: true` |
| `npm run smoke -- --json`                  | Agente `padre`; respuesta `OK`; sesión eliminada                                   |
| `npm run smoke -- --agent frontend --json` | Agente `frontend`; respuesta `OK`; sesión eliminada                                |
| `npm run test:real`                        | 1 prueba real pasa                                                                 |
| `npm run test:sdk`                         | 1 prueba del host SDK pasa                                                         |

El servidor usado fue el V2.2.5 de la app en `127.0.0.1:28894`, descubierto con
`Service.discover()`. La prueba real usó `opencode/deepseek-v4.1-flash-free` y
también pasó con `padre` y `frontend`.

### Incidencia encontrada y resuelta

El modelo por defecto del servidor, `google/gemini-omni-1.2-flash`, no soporta
tool use. OpenCode rechazó la petición con:

```text
provider.invalid-request: No endpoints found that support tool use
```

La solución fue fijar en `.env` un modelo con `capabilities.tools=true`:

```text
OPENCODE_MODEL=opencode/deepseek-v4.1-flash-free
```

`.env` es local, está ignorado por Git y no contiene secretos. Para producción se
debe elegir un modelo con herramientas y presupuesto conocido.

## Problemas pendientes

- Validar el flujo de conexión de la app Desktop a un servidor V2 dedicado.
- Diseñar el plugin de herramientas de sesión en la Fase 3.
- Implementar worktrees aislados y locks.
- Implementar la base durable y la recuperación.
- Elegir modelos por rol para producción y definir presupuestos.

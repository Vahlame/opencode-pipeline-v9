# Arquitectura de la Fase 1

## Decisión principal

El orquestador depende de una interfaz `OpenCodeAdapter`, no de un SDK concreto. Esto permite cambiar el runtime sin tocar el dominio ni el futuro scheduler.

```text
CLI / servicios del orquestador
          │
          ▼
   OpenCodeAdapter
     ├── HttpOpenCodeAdapter  → servidor V2 (modo interactivo)
     ├── SdkOpenCodeAdapter   → host embebido (CI/headless)
     └── MockOpenCodeAdapter  → tests deterministas
```

## Por qué HTTP es el runtime interactivo

El SDK V2 embebido no abre un servidor HTTP. Si el orquestador lo usa, la app de OpenCode no puede conectarse a ese host para observar las sesiones. El runtime HTTP permite que la app y el orquestador usen el mismo servidor V2 y compartan la vista de sesiones, diffs y tool calls.

## Por qué el SDK sigue existiendo

- Pruebas de integración sin depender de un servidor externo.
- CI y ejecución headless.
- Aislamiento con directorios temporales.
- Fallback si el servidor HTTP no está disponible.

El SDK usa un directorio temporal y variables `XDG_*`/`OPENCODE_DB` aisladas por defecto. No reutiliza la base de datos de la app.

## Por qué mock

El mock implementa exactamente el mismo contrato, incluye los 11 perfiles y permite verificar creación de sesión, prompt, espera, transcripción y borrado sin consumir tokens.

## Añadido en la Fase 2

- `SqliteStore` con migraciones versionadas y transacciones.
- `AuthorizationService` deny-by-default con identidad HMAC revalidada en DB.
- `TokenService` para humanos y agentes.
- `OrchestratorService` para proyectos, planes, tareas, módulos, contratos,
  revisiones, aprobaciones, mensajes, checkpoints y estado compartido.
- `OutboxDispatcher` con reintentos.
- API HTTP local y CLI de operaciones.
- Esquema documentado en `docs/schema.md`.

La Fase 2 **no** entrega todavía sesiones OpenCode reales, worktrees, scheduler de
ejecución ni entrega de mensajes a sesiones ocupadas.

## Límites de la Fase 1

- No hay scheduler.
- No hay SQLite del orquestador.
- No hay eventos durables ni outbox.
- No hay jurado consolidado ni integración final.
- No hay worktrees creados por el orquestador.
- No hay autenticación de agentes por sesión todavía.

## Preparación para fases posteriores

- Los IDs y entidades del dominio ya incluyen planes, tareas, módulos, contratos, eventos, mensajes, revisiones y aprobaciones.
- Las transiciones de estado están centralizadas en `src/domain/transitions.ts`.
- Los perfiles ya definen autoridad, límites, entradas y salidas estructuradas.
- El futuro plugin de OpenCode podrá usar `context.sessionID` para identificar la sesión real.

## Riesgos conocidos

- La API V2 es reciente; fijar versiones y probar actualizaciones.
- La app Desktop puede actualizarse y cambiar su CLI interno.
- El modelo por defecto puede no soportar herramientas; para fases posteriores se debe elegir un modelo con `capabilities.tools`.
- La API GUI de OpenCode Desktop es experimental y no forma parte de la Fase 1.

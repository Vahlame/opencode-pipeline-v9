# Fase 3 — Scheduler, worktrees y ejecución paralela real

## Objetivo

Ejecutar tareas aprobadas en sesiones OpenCode reales, con DAG, contratos,
aislamiento Git, concurrencia, leases y evidencia observable.

## Implementado

- Migración `002_phase3.sql`: `leases`, `worktrees`, `task_attempts`.
- `Scheduler` con:
  - plan aprobado y proyecto `RUNNING` obligatorios;
  - refresco `PENDING -> READY` por dependencias;
  - detección de dependencias fallidas;
  - prioridad;
  - claims transaccionales con `BEGIN IMMEDIATE`;
  - límite de paralelismo;
  - leases con expiración y recuperación;
  - reintentos limitados.
- `TaskExecutor`:
  - worktree Git independiente por tarea;
  - sesión OpenCode real;
  - contrato enviado como contexto;
  - permisos de sesión por rutas;
  - heartbeat del lease;
  - timeout de sesión;
  - tests del contrato sin shell;
  - commit creado por el orquestador;
  - versión inmutable de módulo;
  - transición a `IN_REVIEW`.
- `SessionManager`:
  - crear sesión, prompt, espera, transcripción, interrupción y persistencia;
  - detección de sesión fallida por `outcome`;
  - entrega diferida de mensajes técnicos cuando la sesión está inactiva.
- `WorktreeManager`:
  - `git worktree` por tarea;
  - ramas `orch/task/<task-id>`;
  - validación canónica de rutas;
  - rechazo de symlinks y rutas fuera del contrato;
  - commits con hooks desactivados;
  - ejecución de tests `node <script>` sin shell.
- CLI:
  - `scheduler:run`
  - `scheduler:recover`
  - `sessions:list`
  - `worktrees:list`
  - `attempts:list`
  - `session:stop`
- API:
  - `GET /api/sessions`
  - `GET /api/worktrees`
  - `GET /api/attempts`
- 6 pruebas nuevas entre scheduler y worktrees; 61 pruebas pasan en total.

## Demostración real

Script: `scripts/phase3-demo.ps1`.

Resultado real con el servidor V2.2.5 y el modelo
`opencode/deepseek-v4.1-flash-free`:

```json
{
  "sessions": 2,
  "worktrees": 2,
  "results": [
    {
      "task": "tsk_76b36...",
      "status": "SUCCEEDED",
      "commit": "85e245a6a28a38d03bf98943aa0ee337728bc96c"
    },
    {
      "task": "tsk_12f15...",
      "status": "SUCCEEDED",
      "commit": "24fc2f145d973c48b59535e4652dd9b30d5f307d"
    }
  ],
  "concurrentOverlap": true,
  "dependentTaskState": "PENDING",
  "unauthorizedContractDenied": true,
  "rejectedOperations": 1,
  "events": 39
}
```

Worktrees generados:

```text
.worktrees/tsk_76b36c31332d4b5581915de493b02cb6
  branch: orch/task/tsk_76b36c31332d4b5581915de493b02cb6
  commit: 85e245a6a28a38d03bf98943aa0ee337728bc96c
  paths: modules/frontend/demo.mjs, modules/frontend/demo.test.mjs

.worktrees/tsk_12f150aea11b40feb77b8965bd6d9423
  branch: orch/task/tsk_12f150aea11b40feb77b8965bd6d9423
  commit: 24fc2f145d973c48b59535e4652dd9b30d5f307d
  paths: modules/backend/demo.mjs, modules/backend/demo.test.mjs
```

Los commits no contienen escrituras cruzadas:

```text
85e245a -> modules/frontend/demo.mjs, modules/frontend/demo.test.mjs
24fc2f1 -> modules/backend/demo.mjs, modules/backend/demo.test.mjs
```

Intervalos reales de ejecución:

```text
Task A: 2026-11-06T15:35:10.959Z -> 2026-11-06T15:35:22.803Z
Task B: 2026-11-06T15:35:10.960Z -> 2026-11-06T15:35:21.552Z
```

Ambos intervalos se solapan; las sesiones fueron distintas y los worktrees
distintos. La tarea C, dependiente de A, permaneció en `PENDING` porque A quedó
en `IN_REVIEW`, no `APPROVED`.

## Pruebas obligatorias

| Requisito                                   | Evidencia                                           |
| ------------------------------------------- | --------------------------------------------------- |
| No ejecutar sin aprobación humana           | `tests/integration/scheduler.test.ts`               |
| Dos tareas independientes simultáneas       | Scheduler test + demo real `concurrentOverlap=true` |
| Tarea dependiente espera                    | Scheduler test + tarea C en `PENDING`               |
| Sin escrituras cruzadas                     | Worktree test + paths de commits reales             |
| Agente sin autorización no cambia contratos | `tests/integration/authorization.test.ts`           |
| Eventos actualizan estado compartido        | Phase 2 state tests + demo events                   |
| Mensaje técnico no es orden oficial         | Phase 2 messaging tests                             |
| Sin ejecución duplicada por carrera         | Scheduler duplicate-claim test + leases             |

## Decisiones

- Se usó el **servidor V2 de la app** ya activo, no un servidor dedicado. Esto
  permite ver las sesiones y diffs en la app. Para producción se recomienda un
  servidor dedicado.
- El modelo exacto “DeepSeek V4.1 Flash Max” no está en el catálogo local. El
  modelo `opencode/deepseek-v4.1-flash` falló con **Insufficient account funds**.
  La demo usa `opencode/deepseek-v4.1-flash-free`, que soporta tools y funcionó.
  Para producción hay que financiar el proveedor o aceptar el modelo gratuito.
- Los worktrees se crean con Git directamente, no con la API de worktrees de
  OpenCode, para controlar ruta, rama, validación y commit.
- La demo real usó el servidor V2 de la app y el modelo gratuito porque el
  proveedor de pago devolvió `Insufficient account funds`.
- Un especialista intentó crear un contrato y fue denegado; la denegación quedó
  en `audit_log` y `rejected` la muestra.
- La identidad de agente dentro de OpenCode sigue siendo por sesión/perfil, pero
  las herramientas del orquestador no se exponen todavía a los agentes. El
  orquestador ejecuta tests y crea commits; el agente solo edita archivos.
- Los permisos por sesión restringen `edit` a las rutas del contrato y deniegan
  shell, directorios externos, subagentes, web y `.git`.
- La aprobación humana se realiza por CLI/API. La GUI de la app puede observar
  sesiones y diffs, pero el panel de aprobación GUI queda pendiente.
- No hay sandbox de sistema operativo; el aislamiento es API/sesión, worktree,
  permisos de OpenCode y validación de rutas.
- Los worktrees se conservan para evidencia y recuperación; no se borran
  automáticamente.

## Bloqueos y pendientes para la Fase 4

1. **Fondos/modelo:** el modelo de pago elegido no tiene fondos; confirmar modelo
   y presupuesto antes de producción.
2. **Herramientas de sesión:** falta el plugin de OpenCode para que los agentes
   reporten progreso, lean mensajes y entreguen resultados sin shell. La Fase 3
   funciona con edición de archivos y validación server-side.
3. **Servidor dedicado:** decidir si la Fase 4/5 se ejecuta contra el servidor
   actual de la app o uno dedicado.
4. **Consolidación de jurado:** los entregables quedan en `IN_REVIEW`; la Fase 4
   debe aprobar/rechazar, consolidar y devolver rework.
5. **Worktrees sucios:** política de limpieza/forzado y preservación de evidencia.
6. **GUI de aprobación:** panel en la app o web local; hoy solo CLI/API.
7. **Límites de tokens/coste:** el scheduler limita tiempo, concurrencia e
   intentos, pero no aplica presupuesto de tokens/coste por tarea.
8. **Recuperación completa:** los leases se recuperan, pero falta reconciliación
   de sesiones/worktrees tras caída y reintentos idempotentes de commits.

# Fase 4 — Jurado independiente, consolidación y rework

## Objetivo

Evaluar cada versión inmutable de un módulo con cuatro jueces independientes,
consolidar el veredicto de forma determinista y devolver únicamente el módulo
rechazado a su autor.

## Componentes implementados

### Cuatro jueces

| Juez         | Rol                  | Obligatorio                         |
| ------------ | -------------------- | ----------------------------------- |
| Pruebas      | `JUDGE_TESTS`        | Sí                                  |
| Depuración   | `JUDGE_DEBUG`        | Sí                                  |
| Arquitectura | `JUDGE_ARCHITECTURE` | Sí                                  |
| Optimización | `JUDGE_OPTIMIZATION` | Solo bloquea `CRITICAL` demostrable |

Cada juez se ejecuta en una sesión OpenCode distinta sobre el mismo worktree
detached del commit, con permisos de solo lectura y sin shell. El orquestador
ejecuta los tests del contrato en un snapshot separado y entrega la evidencia a
los jueces.

### Consolidación determinista

`JuryVerdictService` no usa un modelo. Reglas:

- Los cuatro roles deben tener dictamen.
- Pruebas, depuración y arquitectura deben aprobar y tener evidencia.
- Un hallazgo `MAJOR` o `CRITICAL` de un juez obligatorio bloquea.
- Un juez ausente o un informe inválido se registra como rechazo; nunca como
  aprobación.
- Optimización solo bloquea con `CRITICAL`, evidencia no vacía y categoría
  verificable.
- `MINOR`/`MAJOR` de optimización quedan como recomendaciones.
- El veredicto y el hash de la consolidación se persisten.

### Correcciones

`JuryDecisionService`:

- Aprueba: actualiza tarea, módulo y versión; inserta en `approved_modules`.
- Rechaza: marca solo ese módulo/versión/tarea; crea una tarea de rework para el
  mismo autor con el contrato clonado; conserva versiones y dictámenes.
- Limita los ciclos con `ORCH_MAX_REWORK_CYCLES` (por defecto 2).
- Al superar el límite, bloquea y no crea más rework.
- Una versión nueva no hereda la aprobación de la anterior.

### Persistencia

Migración `003_phase4.sql`:

- `tasks.review_cycle`.
- `jury_runs`.
- `jury_consolidations`.
- `approved_modules`.

## Demostración real

### Versión defectuosa

Se creó una versión del módulo `phase3-frontend` cuyo `add` restaba:

```text
commit: 1862997da00f40f8beaa1aecaa543bbbedb83e57
moduleVersion: mdv_6850b9bd4e744888ab9e124905620758
```

El orquestador ejecutó el test del contrato y obtuvo `FAIL`. Los cuatro jueces
reales emitieron dictámenes independientes:

```text
JUDGE_TESTS: REJECT
JUDGE_DEBUG: REJECT
JUDGE_ARCHITECTURE: REJECT
JUDGE_OPTIMIZATION: REJECT (CRITICAL de aceptación)
```

Consolidación:

```text
verdict: REWORK_REQUIRED
run: jur_5c0f1fa3e43f4bdfa221173121605242
consolidation: con_961761993fc04e46a46ca96de1913110
blocking findings: 12
```

Se creó únicamente la tarea de rework del módulo frontend:

```text
task: tsk_ce71d427e2bd42a7be32cdd561a8f59e
owner: agente frontend
cycle: 1
```

El módulo backend conservó su tarea en `IN_REVIEW`; no se tocó.

### Corrección

El scheduler ejecutó el rework con OpenCode real:

```text
session: ses_0633a3fdfb8b46f6990a33777df85083
commit: a633ca21223d979cc3a8830fc1dff63a79e72ca7
moduleVersion: mdv_2aa0d89205fa44479227dd22ca52d799
```

### Versión aprobada

El segundo jurado real emitió:

```text
JUDGE_TESTS: APPROVE
JUDGE_DEBUG: APPROVE
JUDGE_ARCHITECTURE: APPROVE
JUDGE_OPTIMIZATION: APPROVE
```

Consolidación:

```text
verdict: APPROVED
run: jur_395627a1ce8e463bb6d8d6b7370cf1b8
consolidation: con_f48a43df66204a368780787a0cbbe2be
blocking findings: 0
approved module: apm_296d4c62fb5e47df8b5e5b2aabdddd7f
approved commit: a633ca21223d979cc3a8830fc1dff63a79e72ca7
```

Estado final del módulo frontend:

```text
version 1: IN_REVIEW        (histórica)
version 2: REWORK_REQUIRED  (defectuosa, conservada)
version 3: APPROVED         (corregida)
```

Estado de los demás módulos:

```text
phase3-backend: version 1 IN_REVIEW; tarea IN_REVIEW
dependent task: PENDING
```

## Pruebas

| Prueba                                     | Evidencia                                          |
| ------------------------------------------ | -------------------------------------------------- |
| Cuatro dictámenes independientes           | Cuatro sesiones reales y cuatro filas de `reviews` |
| Tres aprobaciones obligatorias             | `tests/unit/jury-verdict.test.ts`                  |
| Optimización menor no bloquea              | Test unitario                                      |
| Optimización grave sí bloquea              | Test unitario                                      |
| Juez ausente no aprueba                    | Test unitario + consolidación `INCOMPLETE`         |
| Módulo rechazado vuelve a su autor         | Test de integración + rework real                  |
| Otros módulos conservan progreso           | Backend en `IN_REVIEW`; test de integración        |
| Ciclos limitados                           | `ORCH_MAX_REWORK_CYCLES` + test de integración     |
| Modificación posterior invalida aprobación | Test de integración y registro por versión         |
| Jueces no alteran código                   | Sesiones de solo lectura + snapshots               |

Verificación:

```text
npm run check  -> 71 pruebas pasan, 2 omitidas
npm run build  -> pasa
test:real      -> 1 prueba real pasa
test:sdk       -> 1 prueba SDK pasa
db:migrate     -> esquema 3
```

## Decisiones

- Los jueces usan sesiones OpenCode reales y el modelo
  `opencode/deepseek-v4.1-flash-free`; el modelo de pago no tenía fondos.
- Los tests del contrato se ejecutan en un snapshot separado; los jueces reciben
  evidencia y un snapshot limpio de solo lectura.
- Optimización se rige por una definición determinista de `CRITICAL`: evidencia
  no vacía y categoría verificable.
- Un juez ausente o inválido se registra como rechazo conservador.
- La aprobación se vincula a `moduleVersionId`, commit y hash; no se hereda.
- El rework se limita por configuración y conserva las versiones anteriores.
- La aprobación se registra en `approved_modules`; todavía no hay integración
  final ni feedback global.

## Bloqueos y pendientes

1. **Modelo/fondos:** confirmar presupuesto o mantener el modelo gratuito.
2. **GUI de aprobación:** el jurado funciona por CLI/API; falta el panel en la app.
3. **Plugin de herramientas:** los jueces no tienen herramientas de agente
   adicionales; leen el snapshot y reciben evidencia del orquestador.
4. **Integración:** `approved_modules` existe, pero el ensamblado final y los
   adaptadores son de la siguiente fase.
5. **Feedback global:** no implementado.
6. **Limpieza de worktrees:** los snapshots y worktrees de rework se conservan.
7. **Módulo backend legado:** su versión se creó antes de la actualización de
   estado de módulo; la tarea sigue en `IN_REVIEW` y no fue afectada.
8. **Límites de tokens/coste:** no se aplican todavía por jurado.

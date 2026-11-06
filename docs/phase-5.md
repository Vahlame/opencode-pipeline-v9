# Fase 5 - Integracion hibrida, feedback global y entrega final

## Objetivo

Ensamblar exclusivamente versiones aprobadas e inmutables, resolver
incompatibilidades menores con adaptadores versionados, escalar incompatibilidades
estructurales al coordinador, producir un manifiesto reproducible y evaluar el
producto integrado contra el plan humano aprobado antes de preparar una entrega.

## Componentes implementados

### IntegrationManager

- Valida proyecto, plan aprobado, versiones, commits, tree hashes, artifact hashes
  y el registro `approved_modules`.
- Rechaza versiones no aprobadas, stale o modificadas despues de la aprobacion.
- Resuelve contratos de tareas `APPROVED`/`INTEGRATED`, no contratos de rework
  pendientes.
- Detecta modulos requeridos ausentes, dependencias faltantes y ciclos.
- Compone snapshots de modulos en un worktree aislado mediante checkout exacto
  del commit aprobado. No hace merges ni toca la logica de los modulos.
- Verifica que los modulos no cambien durante las pruebas.
- Exige que las pruebas de integracion y del adaptador pasen.
- Versiona los adaptadores bajo `integration/adapters/` y registra sus pruebas y
  revision determinista.
- Genera `IntegrationManifest` con modulos, versiones, commits, contratos,
  adaptador, pruebas, conflictos y hash reproducible.
- Es idempotente para la misma entrada inmutable.

### Clasificacion

| Ruta | Ejemplos                         | Accion                                                       |
| ---- | -------------------------------- | ------------------------------------------------------------ |
| A    | `add` expuesto como `sum`        | Adaptador autorizado, probado y versionado                   |
| A    | Diferencias de formato o nombres | Adaptador bajo `integration/adapters/`                       |
| B    | Modulo requerido ausente         | Informe estructural al coordinador, sin manifiesto           |
| B    | Dependencia circular             | Informe estructural, no se modifica ningun modulo            |
| B    | Contrato incumplible             | Se detiene la integracion y se conservan los modulos validos |

Un problema estructural o un adaptador fallido no crea manifiesto ni entrega.
Los modulos aprobados no se editan para ocultar conflictos.

### FeedbackService

- Ejecuta el agente `feedback` en una sesion OpenCode de solo lectura sobre el
  snapshot del commit de integracion.
- Compara plan aprobado, criterios, interfaces, pruebas E2E y evidencia de
  integracion.
- Exige que cada criterio obligatorio tenga `PASS` y evidencia no vacia.
- Un informe ausente, invalido, `FAIL`, sin evidencia o con hallazgos
  `MAJOR`/`CRITICAL` no autoriza entrega.
- Persiste el informe completo en `feedback_runs`.
- En `PASS` crea `final_deliveries` en estado `READY`, guarda manifiesto y
  evidencia, y notifica al padre.
- En `FAIL` conserva modulos validos, envia diagnostico al coordinador y crea
  rework solo para los modulos afectados cuando el informe los identifica.

### Decision final

- `FAIL`: el proyecto vuelve a `RUNNING`, se conserva el manifiesto historico y
  solo se devuelve el trabajo afectado.
- `PASS`: el proyecto permanece en `FEEDBACK` hasta que un humano ejecute
  `delivery:finalize`.
- La entrega final pasa a `DELIVERED` y el proyecto a `COMPLETED` solo con
  aprobacion humana y feedback `PASS`.

### Persistencia

Migracion `004_phase5.sql`:

- `integration_runs`: intentos, base, input hash, estado y error.
- `integration_modules`: version exacta, commit, artifact y contrato.
- `integration_adapters`: path, version, commit, pruebas y revision.
- `integration_conflicts`: clasificacion, evidencia y resolucion.
- `integration_manifests`: manifiesto JSON y hash.
- `feedback_runs`: informe, veredicto y hash.
- `final_deliveries`: resumen y estado de entrega.

## Reproducibilidad

El `inputHash` incluye:

- hash del plan aprobado;
- commit base;
- modulos requeridos, dependencias;
- version, commit, tree hash, artifact hash, aprobacion y contrato de cada modulo;
- especificacion, archivos y pruebas de cada adaptador;
- archivos y comandos de pruebas de integracion;
- criterios y mapeos de interfaz.

El manifiesto se hashea sin su timestamp. El commit de integracion usa autor,
committer y fecha deterministas anclados despues de la aprobacion mas reciente.
La misma entrada reutiliza el manifiesto existente en vez de crear otro.

## Demostracion real

### Modulos aprobados

```text
phase3-frontend
  version: 3
  moduleVersion: mdv_2aa0d89205fa44479227dd22ca52d799
  commit: a633ca21223d979cc3a8830fc1dff63a79e72ca7
  approvedModule: apm_296d4c62fb5e47df8b5e5b2aabdddd7f

phase3-backend
  version: 1
  moduleVersion: mdv_86a808153f8d493ca344573e108e3450
  commit: 24fc2f145d973c48b59535e4652dd9b30d5f307d
  approvedModule: apm_d556bf085be04e71bc6a4cf12767b925
```

### Incompatibilidad menor y adaptador

El contrato del frontend expone `add`; la integracion requiere `sum`.

```text
conflict: INTERFACE_NAME_MISMATCH
expected: sum
provided: add
resolution: integration/adapters/frontend-sum.mjs@v1
```

El adaptador delega en `add` sin modificar el modulo. Sus pruebas y la prueba E2E
pasan.

### Fallo estructural controlado

```text
run: irn_09f2f0daf4e440febbbdbe2756604db9
status: STRUCTURAL_FAILED
conflict: REQUIRED_MODULE_NOT_FOUND
missing: phase3-database
manifest: none
```

El informe se envio al coordinador. No se creo manifiesto, no se modifico ningun
modulo y el proyecto no avanzo a feedback.

### Integracion exitosa

```text
run: irn_5678bc90dd304bd7b40314e6dff36154
status: SUCCEEDED
manifest: imn_d99a37b10bbc445287e93f56292dca8d
manifestHash: 6aa179754e9b6f0cb486ee391dd45bb697a7187d23d7a9ddb3f75df57bc93551
integrationCommit: a024fc0732a85a2e3f2ade89717ddf516556a356
baseCommit: 4ac878b00d807800c4c71b1a95e46c400440e4b8
modules: 2
adapters: 1
conflictos menores resueltos: 1
```

Pruebas registradas:

```text
node integration/tests/e2e.mjs              PASS
node modules/frontend/demo.test.mjs         PASS (11/11)
node modules/backend/demo.test.mjs          PASS
node integration/adapters/frontend-sum.test.mjs PASS
```

### Evaluacion global

Primera evaluacion real sobre el manifiesto anterior:

```text
feedback: fbr_0bd1853e7d664d179ffff20e18c66660
manifest: imn_d563f0d841a24ca2ba7ed3dfeac1097e
verdict: FAIL
causa: timestamp determinista anterior al plan; alcance de checks del repositorio
```

Se corrigio el reloj determinista para anclarlo despues de la aprobacion mas
reciente y se acoto el feedback al plan/criterios/evidencia de integracion. La
segunda evaluacion real aprobo:

```text
feedback: fbr_0524686c7c8e4c008f9007cce1e060fe
manifest: imn_d99a37b10bbc445287e93f56292dca8d
verdict: PASS
criteria: 3/3 PASS con evidencia
hash: 5394d84a4920fda3e7389920d7dcae581720e5c6eb49abd5326ed863b2eccc79
```

### Entrega final

```text
delivery: fdl_9b1e702aca434493872e7d6e20dc6794
status: DELIVERED
project: COMPLETED
```

El padre recibio `FinalDeliveryReady`. La entrega solo se marco como `DELIVERED`
despues de la aprobacion humana explicita. El resumen incluye plan, manifiesto,
modulos, commits, adaptador, criterios, evidencia, hallazgos y comandos de
verificacion.

## Pruebas obligatorias

| #   | Prueba                                     | Evidencia                                                          |
| --- | ------------------------------------------ | ------------------------------------------------------------------ |
| 1   | Solo se integran versiones aprobadas       | `tests/integration/phase5.test.ts` test 1                          |
| 2   | Incompatibilidad menor con adaptador       | Test 2 y demo real `INTERFACE_NAME_MISMATCH`                       |
| 3   | Adaptador probado y validado               | Test 2; adapter test PASS; `review.status=VALIDATED`               |
| 4   | Problema estructural vuelve al coordinador | Test 4 y run real `irn_09f2...`; mensaje al coordinador            |
| 5   | No se modifican modulos ajenos             | Test 5; `moduleTreeHash` y checkout exacto                         |
| 6   | Se conservan versiones de artefactos       | Test 3; `module_versions`, `reviews`, `approved_modules`, adapters |
| 7   | Fallo global devuelve solo lo afectado     | Test 7; rework solo frontend y backend intacto                     |
| 8   | Feedback no aprueba sin evidencia          | Test 8; check `feedback.criteria.evidence=false`                   |
| 9   | Entrega final requiere aprobacion global   | Test 9; `READY` -> `DELIVERED` solo con feedback PASS y humano     |
| 10  | Integracion reproducible                   | Test 10; mismo inputHash, manifiesto y commit; reuso idempotente   |

## Verificacion

```text
npm run check   -> 82 pruebas pasan, 2 omitidas
npm run build   -> pasa
npm run db:migrate -> esquema 4
npm run test:real  -> 1 prueba real pasa
npm run test:sdk   -> 1 prueba SDK pasa
```

## Decisiones y limites

- El integrador es determinista para ensamblado, validacion y manifiesto. El
  agente integrador puede proponer adaptadores con `--agent-adapter`; el
  orquestador valida rutas, escribe, prueba y versiona la propuesta. En la demo
  real se uso una especificacion de adaptador explicita; la ruta asistida por
  agente esta cubierta por el test 2.
- La revision del adaptador es determinista: ruta autorizada, modulos intactos,
  pruebas y version. No sustituye a los cuatro jueces del modulo.
- El feedback no puede aprobar por si solo: la puerta determinista valida
  manifiesto, plan, aprobaciones, commits, pruebas y evidencia.
- Las comprobaciones de CI del repositorio (`npm run check`) no forman parte del
  snapshot de integracion porque los worktrees no incluyen `node_modules`. El
  feedback las registra como recomendacion no bloqueante salvo que se declaren
  como criterio.
- El reloj del manifiesto es determinista y se ancla despues de la aprobacion mas
  reciente para permitir reproducibilidad sin cronologias imposibles.
- Los worktrees y snapshots se conservaron durante la Fase 5. En la Fase 6 se
  aplico `maintenance:cleanup` sobre snapshots limpios; los commits, ramas y la
  evidencia SQLite se conservaron. Ver `docs/phase-6.md`.
- Permanecen tareas historicas del proyecto: la tarea original del frontend en
  `REWORK_REQUIRED` (sustituida por su rework integrado) y la tarea dependiente
  en `PENDING`.
- No hay GUI de aprobacion; las operaciones se ejecutan por CLI/API.

# OpenCode Multiagent Orchestrator V9

Este repositorio contiene el núcleo de un orquestador multiagente sobre **OpenCode V2**. La Fase 1 establece la base técnica, los perfiles de agente y una conexión real comprobable con OpenCode; todavía **no** implementa scheduler, jurado, integración ni feedback completos.

## Estado actual

- Fase 1: base, adaptador y perfiles.
- Runtime interactivo: `HttpOpenCodeAdapter` contra un servidor OpenCode V2.
- Runtime CI/headless: `SdkOpenCodeAdapter` con host embebido y datos aislados.
- Runtime de pruebas: `MockOpenCodeAdapter`.
- Dominio inicial tipado con Zod.
- Perfiles V2 en `.opencode/agents/`.
- Habilidades compartidas en `.opencode/skills/`.
- Sin scheduler, jurado, integración final ni base de datos del orquestador.

## Requisitos

- Node.js **26.x**.
- npm 11.x.
- Git.
- OpenCode **V2.2.5** para la prueba real. La app de OpenCode Desktop ya incluye un CLI V2; el `opencode` del `PATH` puede ser V1.
- No se requiere Bun.

> Importante: este proyecto no migra ni modifica la instalación V1 existente. La prueba real usa el servidor V2 de la app o un servidor V2 dedicado, nunca el `opencode` V1 del `PATH`.

## Instalación

```powershell
npm install
Copy-Item .env.example .env
```

El `.env` local del repositorio de verificación ya apunta a
`opencode/deepseek-v4.1-flash-free`, un modelo con soporte de herramientas. Si
tienes otro proveedor, cambia `OPENCODE_MODEL` o pásalo con `--model`. No uses un
modelo sin `capabilities.tools` para tareas de agente.

## Comandos

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run doctor
npm run agents
npm run smoke
npm run test:real
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

- Denegación por defecto en la configuración del proyecto.
- Sin shell libre para agentes.
- Sin edición fuera de las rutas autorizadas.
- Sin `.env`, `.git` ni acceso a directorios externos.
- Sin subagentes, web ni skills no autorizadas.
- La autorización efectiva se implementará en el orquestador en fases posteriores; OpenCode es una capa de defensa adicional.

## Documentación

- `docs/architecture.md`: decisiones y límites.
- `docs/phase-1.md`: alcance, verificaciones y pendientes.
- `docs/opencode-v2.md`: notas de integración V2.
- `AGENTS.md`: instrucciones persistentes para agentes.

## Próximas fases

La Fase 2 incorporará SQLite, eventos durables, outbox, planes, DAG, leases y autorización. La Fase 3 añadirá worktrees, ejecución paralela real y mensajería. No se avanza automáticamente sin completar y verificar cada fase.

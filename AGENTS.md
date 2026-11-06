# Instrucciones del proyecto

## Contexto

Este repositorio implementa la Fase 1 de **OpenCode Multiagent Orchestrator V9** sobre OpenCode V2. El objetivo es una base modular, tipada y verificable; el scheduler, el jurado, la integración y el feedback completos pertenecen a fases posteriores.

## Comandos de verificación

Antes de declarar terminado un cambio:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
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
- `src/cli.ts`: comandos locales.
- `.opencode/agents/`: perfiles V2 en Markdown.
- `.opencode/skills/`: instrucciones compartidas.
- `docs/`: decisiones y alcance.

No importes `@opencode/client` ni `@opencode/sdk` fuera de `src/opencode/`. El resto del sistema debe depender de `OpenCodeAdapter`.

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

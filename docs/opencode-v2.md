# Integración con OpenCode V2

## Versiones observadas

- OpenCode Desktop: 2.2.5.
- CLI interno de la app: 2.2.5.
- Paquetes usados por el proyecto: `@opencode/client@2.2.5`, `@opencode/sdk@2.2.5`, `@opencode/plugin` transitivo 2.2.5.
- `opencode` del `PATH`: V1.18.34; **no se usa**.

## Descubrimiento del servidor

`HttpOpenCodeAdapter.create()`:

1. Si `OPENCODE_BASE_URL` está definido, usa esa URL.
2. Si no, llama a `Service.discover()` de `@opencode/client/service`.
3. Usa `Service.headers(endpoint)` para obtener autenticación Basic.
4. Crea el cliente con `OpenCode.make()`.

La contraseña no se imprime ni se persiste.

## Sesiones

- `session.create({ location, agent, title, model?, permissions?, metadata? })`
- `session.prompt({ sessionID, text, delivery })`
- `session.wait({ sessionID })`
- `session.context({ sessionID })`
- `session.remove({ sessionID })`

La respuesta se extrae de los mensajes `assistant` con contenido de tipo `text`.

## SDK embebido

`SdkOpenCodeAdapter`:

- Crea un directorio temporal si no se proporciona `OPENCODE_SDK_DATA_DIR`.
- Define `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` y `OPENCODE_DB`.
- Crea el host con `OpenCode.create()`.
- Restaura las variables y elimina el directorio temporal al cerrar.

## Perfiles

Los perfiles viven en `.opencode/agents/<id>.md` y usan frontmatter V2:

```yaml
---
description: ...
mode: primary
steps: 18
permissions:
  - action: read
    resource: '**'
    effect: allow
  - action: shell
    resource: '*'
    effect: deny
---
```

No se usan `permission`, `tools`, `maxSteps` ni otras claves V1.

## Skills

Las skills viven en `.opencode/skills/<id>/SKILL.md` con frontmatter `name` y `description`. El ID se deriva del directorio.

## Nota sobre eventos

El stream de eventos V2 es volátil y no tiene replay. La Fase 2 deberá persistir eventos propios y reconciliar; no se debe usar el stream como fuente de verdad.

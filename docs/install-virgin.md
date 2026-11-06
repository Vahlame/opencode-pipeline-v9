# Instalacion en Windows virgen

## Requisitos

- Windows 10/11 x64.
- Node.js 26.x (minimo 26.4.0).
- Git.
- npm.
- OpenCode Desktop V2.2.5 o superior.

No uses el `opencode` V1 del PATH. La app V2 usa su propio CLI/servidor.

## Instalacion automatica

```powershell
cd "C:\Users\<usuario>\Documents\desarrollo de software pipeline"
powershell -ExecutionPolicy Bypass -File .\scripts\install-virgin.ps1
```

El script:

1. comprueba Windows, Node, npm y Git;
2. crea `.env` desde `.env.example` si no existe;
3. genera `ORCH_AUTH_SECRET` y `ORCH_TOOL_SECRET`;
4. instala dependencias con `npm ci`;
5. ejecuta migraciones, build y doctor.

Para ver que haria sin tocar nada:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-virgin.ps1 -DryRun
```

## OpenCode virgen

1. Instala OpenCode Desktop V2.2.5+.
2. Abre la carpeta del proyecto.
3. Reinicia el servidor de OpenCode para cargar `.opencode/agents` y
   `.opencode/plugins/orchestrator-tools.js`.
4. Verifica:

```powershell
npm run doctor
npm run smoke -- --agent padre --prompt "Responde OK" --json
```

## Arranque

```powershell
npm run serve
```

Abrir:

```text
http://127.0.0.1:4400/ui
```

El panel pide un Project ID y un token humano.

## Token humano

```powershell
npx tsx src/cli.ts auth:issue --kind HUMAN --subject human
```

No copies el token a prompts, repositorio ni documentacion.

## Comprobaciones

```powershell
npm run check
npm run build
npm run db:migrate
npm run doctor
npm run test:real
npm run test:sdk
```

## Estado de la prueba

En esta maquina se probo un clon local limpio (sin `.env`, `.runtime` ni
`node_modules`), se ejecuto `install-virgin.ps1` y despues `npm run check`:

```text
31 archivos de prueba; 103 pruebas pasan, 2 omitidas
```

Tambien se corrigio el problema de CRLF que hacia fallar `format:check` en un
clon nuevo: `.gitattributes` fuerza `eol=lf` y Prettier usa `endOfLine: auto`.

## Limitaciones de una instalacion virgen

- No se puede validar una maquina virgen desde esta sesion; el script es
  reproducible pero debe probarse en una VM Windows limpia.
- El plugin de OpenCode requiere reiniciar el servidor.
- La GUI escucha en localhost; no se debe exponer a Internet.
- `ORCH_TOOL_SECRET` debe estar en el entorno del servidor OpenCode para que el
  plugin pueda llamar al API.

# Instalar OpenCode Pipeline V9 desde este ZIP

Este ZIP es una distribucion de codigo fuente, no un `.exe`. La instalacion se
hace en Windows 10/11 x64 con PowerShell.

Si eres un agente de OpenCode leyendo esto: sigue los pasos en orden, no
improvises cambios de seguridad y pide autorizacion humana antes de ejecutar
comandos destructivos.

## 1. Requisitos

- Windows 10/11 x64.
- Node.js **26.4.0 o superior**.
- npm.
- Git.
- OpenCode Desktop **V2.2.5 o superior**.

No uses el `opencode` V1 que pueda estar en el `PATH`. La app V2 usa su propio
CLI y servidor.

Comprobacion rapida:

```powershell
node --version
npm --version
git --version
```

## 2. Descomprimir

Descomprime el ZIP en una carpeta local. Ejemplo:

```text
C:\Users\<usuario>\Documents\opencode-pipeline-v9
```

Abre PowerShell dentro de esa carpeta. Todos los comandos siguientes se ejecutan
ahi.

## 3. Instalar

```powershell
powershell -ExecutionPolicy Bypass -File .\INSTALAR.ps1
```

Equivale a:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-virgin.ps1
```

El instalador:

1. comprueba Windows, Node 26.4+, npm y Git;
2. crea `.env` desde `.env.example` si no existe;
3. genera `ORCH_AUTH_SECRET` y `ORCH_TOOL_SECRET` aleatorios;
4. ejecuta `npm ci`;
5. ejecuta migraciones;
6. compila;
7. ejecuta `npm run doctor`.

Si `doctor` falla porque OpenCode no esta abierto, el instalador avisa y termina
con error. Abre OpenCode Desktop V2, espera a que arranque su servidor y ejecuta:

```powershell
npm run doctor
```

No vuelvas a ejecutar todo el instalador solo por eso.

## 4. Verificar

Recomendado:

```powershell
npm run check
```

Debe dar:

```text
31 archivos de prueba; 104 pruebas pasan, 2 omitidas
```

No ejecutes `npm run test:real` ni `npm run test:sdk` sin autorizacion: consumen
tokens y requieren OpenCode real.

## 5. Abrir en OpenCode V2

1. Abre OpenCode Desktop V2.2.5+.
2. Abre como proyecto la carpeta descomprimida.
3. Reinicia el servidor de OpenCode para que cargue:
   - `.opencode/agents/`
   - `.opencode/skills/`
   - `.opencode/plugins/orchestrator-tools.js`
4. Comprueba que el plugin responde pidiendo `orchestrator_state` con el
   `projectId` del proyecto.

El plugin necesita que la API local este arrancada y que exista
`ORCH_TOOL_SECRET` en `.env`. El plugin carga el `.env` desde la carpeta del
proyecto.

## 6. Arrancar la GUI

```powershell
npm run open
```

o crea el acceso directo:

```powershell
npm run shortcut
```

Abre:

```text
http://127.0.0.1:4400/ui
```

La GUI pide un `Project ID` y un token humano. Para emitir el token:

```powershell
npx tsx src/cli.ts auth:issue --kind HUMAN --subject human
```

No copies el token a prompts, commits, documentacion ni issues.

## 7. Contabilidad de tokens

La GUI tiene la seccion **Contabilidad** con desglose por subagente, tarea y
proposito. Los datos salen de los tokens que reporta OpenCode por mensaje.

Para importar sesiones historicas:

```powershell
npx tsx src/cli.ts usage:sync --project <project-id> --token $HUMAN
```

Para consultar por consola:

```powershell
npx tsx src/cli.ts usage:breakdown --project <project-id> --by agent --token $HUMAN
npx tsx src/cli.ts usage:breakdown --project <project-id> --by task --token $HUMAN
npx tsx src/cli.ts usage:breakdown --project <project-id> --by purpose --token $HUMAN
```

## 8. Reglas de seguridad

- No subas `.env`, `.runtime`, `.worktrees`, `node_modules` ni `dist` a Git.
- No expongas el puerto `4400` a Internet; la GUI es local.
- No uses el `opencode` V1.
- No ejecutes `maintenance:cleanup --keep-days 0 --apply`: borra worktrees
  limpios. El valor recomendado es `--keep-days 7`.
- No borres `.worktrees` ni `.runtime` sin autorizacion humana.
- Los agentes no deben tener shell libre; el orquestador ejecuta pruebas y
  commits.
- No hagas push, despliegue ni cambios de credenciales sin autorizacion.

## 9. Criterio de exito

```text
npm run doctor  -> adapter ok, OpenCode V2.2.5, 13 agentes reconocidos
npm run check   -> 104 pruebas pasan, 2 omitidas
npm run build   -> PASS
npm run serve   -> API en 127.0.0.1:4400
GET /ui         -> Control Room con Contabilidad
```

Si algo falla, adjunta la salida exacta del comando y el contenido de
`npm run doctor` (sin secretos) antes de cambiar configuracion.

## 10. Limitaciones conocidas

- No se probo en una VM Windows completamente virgen; si se probo en un clon
  limpio sin `.env`, `.runtime` ni `node_modules`.
- No hay sandbox de sistema operativo por worktree; el aislamiento actual es por
  permisos, worktree Git y ausencia de shell.
- `npm audit` reporta vulnerabilidades transitivas del SDK de OpenCode y
  `gitlab-ai-provider` sin fix disponible. No se usa el proveedor GitLab.
- La entrega final requiere feedback `PASS` y aprobacion humana.

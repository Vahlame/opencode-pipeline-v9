param(
  [string]$RepoPath = (Get-Location).Path,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-Location $RepoPath

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

Write-Step "OpenCode Multiagent Orchestrator V9 - instalacion"
Write-Host "Directorio: $RepoPath"

if (-not $IsWindows) {
  throw 'Este instalador esta pensado para Windows.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js no esta instalado. Instala Node 26.x y vuelve a ejecutar.'
}
$nodeVersion = (node --version).Trim()
Write-Host "Node: $nodeVersion"
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'npm no esta disponible.'
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'Git no esta disponible.'
}

$envPath = Join-Path $RepoPath '.env'
$examplePath = Join-Path $RepoPath '.env.example'
if (-not (Test-Path $envPath)) {
  if ($DryRun) {
    Write-Host 'DRY-RUN: crearia .env desde .env.example'
  } else {
    Copy-Item $examplePath $envPath
    node -e "const fs=require('fs');const c=require('crypto');const p='.env';let s=fs.readFileSync(p,'utf8');const set=(k,v)=>{const r=new RegExp('^'+k+'=.*$','m');if(r.test(s))s=s.replace(r,k+'='+v);else s+=(s.endsWith('\n')?'':'\n')+k+'='+v+'\n'};set('ORCH_AUTH_SECRET',c.randomBytes(32).toString('hex'));set('ORCH_TOOL_SECRET',c.randomBytes(32).toString('hex'));fs.writeFileSync(p,s);"
    Write-Host 'Creado .env con secretos aleatorios.'
  }
} else {
  Write-Host '.env ya existe; no se sobrescribe.'
}

if ($DryRun) {
  Write-Host 'DRY-RUN: npm ci'
} elseif (Test-Path (Join-Path $RepoPath 'package-lock.json')) {
  npm ci
} else {
  npm install
}

if (-not $DryRun) {
  npm run db:migrate
  npm run build
  npm run doctor
}

Write-Step 'Siguiente paso'
Write-Host @'
1. Instala/abre OpenCode Desktop V2.2.5 o superior.
2. Abre esta carpeta como proyecto.
3. Reinicia el servidor de OpenCode para que cargue .opencode/plugins/orchestrator-tools.js.
4. Ejecuta: npm run serve
5. Abre: http://127.0.0.1:4400/ui
6. Crea un token humano:

   npx tsx src/cli.ts auth:issue --kind HUMAN --subject human

7. No uses el opencode V1 del PATH; usa el V2 de la app.
'@ -ForegroundColor Green

Write-Host 'Instalacion base completada.' -ForegroundColor Green

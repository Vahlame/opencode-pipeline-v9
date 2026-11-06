param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$healthUrl = 'http://127.0.0.1:4400/api/health'
$uiUrl = 'http://127.0.0.1:4400/ui'

function Test-Health {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-Path (Join-Path $repo '.env'))) {
  Write-Host 'No existe .env. Ejecuta primero .\scripts\install-virgin.ps1' -ForegroundColor Red
  Read-Host 'Pulsa Enter para cerrar'
  exit 1
}

if (-not (Test-Health)) {
  Write-Host 'Iniciando OpenCode Orchestrator...' -ForegroundColor Cyan
  $command = "Set-Location '$repo'; npm run serve"
  Start-Process powershell -ArgumentList @('-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $command) | Out-Null

  $ready = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Health) {
      $ready = $true
      break
    }
  }
  if (-not $ready) {
    Write-Host 'El servidor no respondio en 20 segundos. Revisa la ventana de serve.' -ForegroundColor Red
    Read-Host 'Pulsa Enter para cerrar'
    exit 1
  }
} else {
  Write-Host 'El servidor ya estaba en marcha.' -ForegroundColor Green
}

if (-not $NoBrowser) {
  Start-Process $uiUrl
  Write-Host "GUI abierta: $uiUrl" -ForegroundColor Green
}

Write-Host ''
Write-Host 'Token humano (si lo necesitas):' -ForegroundColor Yellow
Write-Host '  npx tsx src/cli.ts auth:issue --kind HUMAN --subject human'
Write-Host ''
Write-Host 'Para detener el servidor, cierra la ventana que ejecuta npm run serve.'

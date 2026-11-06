param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$version = '26.13.0'
$expectedSha256 = 'dcc60d59a0746999f99064a01c020445d54d84228c691cdbf25b49ac3b59150a'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $projectRoot '.tools'
$targetDir = Join-Path $toolsDir "node-v$version"
$zipPath = Join-Path $toolsDir "node-v$version-win-x64.zip"
$url = "https://nodejs.org/dist/v$version/node-v$version-win-x64.zip"

New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null

if ($Force -or -not (Test-Path (Join-Path $targetDir 'node.exe'))) {
  if ($Force -or -not (Test-Path $zipPath)) {
    Write-Host "Descargando Node v$version..."
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
  }

  $actualSha256 = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $expectedSha256) {
    throw "SHA256 inválido para Node v$version. Esperado: $expectedSha256. Obtenido: $actualSha256"
  }

  $extractedDir = Join-Path $toolsDir "node-v$version-win-x64"
  if (Test-Path $extractedDir) { Remove-Item -Recurse -Force $extractedDir }
  if (Test-Path $targetDir) { Remove-Item -Recurse -Force $targetDir }

  Write-Host "Extrayendo Node v$version..."
  Expand-Archive -Path $zipPath -DestinationPath $toolsDir -Force
  Rename-Item -Path $extractedDir -NewName "node-v$version"
}

$env:PATH = "$targetDir;$env:PATH"
Write-Host "Node activo: $(& (Join-Path $targetDir 'node.exe') --version)"
Write-Host "npm activo: $(& (Join-Path $targetDir 'npm.cmd') --version)"
Write-Host "Ejecuta este script con dot-sourcing para mantener el PATH en la sesión:"
Write-Host "  . .\scripts\setup-node.ps1"

param(
  [switch]$DryRun,
  [switch]$SkipDoctor
)

$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'scripts\install-virgin.ps1'
if (-not (Test-Path $installer)) {
  throw "No se encontro scripts\install-virgin.ps1. Descomprime el ZIP completo."
}

Write-Host 'OpenCode Pipeline V9 - instalador' -ForegroundColor Cyan
Write-Host "Carpeta: $PSScriptRoot"

$arguments = @{ RepoPath = $PSScriptRoot }
if ($DryRun) { $arguments.DryRun = $true }
if ($SkipDoctor) { $arguments.SkipDoctor = $true }

& $installer @arguments

param(
  [string]$Name = 'OpenCode Pipeline V9'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop "$Name.lnk"
$launcher = Join-Path $repo 'scripts\start-orchestrator.ps1'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = 'powershell.exe'
$shortcut.Arguments = "-NoLogo -ExecutionPolicy Bypass -File `"$launcher`""
$shortcut.WorkingDirectory = $repo
$shortcut.Description = 'Inicia el orquestador y abre la Control Room local'
$shortcut.IconLocation = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe,0"
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Host "Acceso directo creado: $shortcutPath" -ForegroundColor Green
Write-Host 'Doble clic para iniciar servidor + GUI.' -ForegroundColor Cyan

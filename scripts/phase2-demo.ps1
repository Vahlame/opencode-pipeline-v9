param(
  [switch]$KeepData
)

$ErrorActionPreference = 'Stop'

if (-not $KeepData) {
  Get-ChildItem -Path (Join-Path $PSScriptRoot '..\.runtime') -Filter 'orchestrator.db*' -ErrorAction SilentlyContinue |
    Remove-Item -Force
}

function Invoke-Orch {
  param([string[]]$Arguments)
  & npx tsx src/cli.ts @Arguments
}

$human = (Invoke-Orch @('auth:issue', '--kind', 'HUMAN', '--subject', 'human') 2>$null | Select-Object -First 1).Trim()
Invoke-Orch @('db:migrate') | Out-Host

$project = Invoke-Orch @('project:create', '--name', 'Demo Fase 2', '--repo', (Get-Location).Path, '--token', $human) |
  ConvertFrom-Json
$projectId = $project.id
$agents = Invoke-Orch @('project:bootstrap', '--project', $projectId, '--token', $human) | ConvertFrom-Json
$padre = ($agents | Where-Object opencodeAgentId -eq 'padre').id
$coordinador = ($agents | Where-Object opencodeAgentId -eq 'coordinador').id
$frontend = ($agents | Where-Object opencodeAgentId -eq 'frontend').id

$parentToken = (Invoke-Orch @('auth:issue', '--kind', 'AGENT', '--agent', $padre) 2>$null | Select-Object -First 1).Trim()
$coordToken = (Invoke-Orch @('auth:issue', '--kind', 'AGENT', '--agent', $coordinador) 2>$null | Select-Object -First 1).Trim()
$frontToken = (Invoke-Orch @('auth:issue', '--kind', 'AGENT', '--agent', $frontend) 2>$null | Select-Object -First 1).Trim()

$plan = Invoke-Orch @('plan:propose', '--project', $projectId, '--title', 'Plan demo Fase 2', '--spec', '{"objective":"demostrar memoria, permisos y mensajes"}', '--token', $parentToken) |
  ConvertFrom-Json
Invoke-Orch @('plan:approve', '--plan', $plan.id, '--hash', $plan.hash, '--token', $human) | Out-Null
Invoke-Orch @('project:start', '--project', $projectId, '--token', $human) | Out-Null

$module = Invoke-Orch @('module:create', '--project', $projectId, '--name', 'frontend-demo', '--owner', $frontend, '--paths', 'modules/frontend/**', '--token', $coordToken) |
  ConvertFrom-Json
$task = Invoke-Orch @('task:create', '--project', $projectId, '--plan', $plan.id, '--title', 'Demo task', '--description', 'Tarea de demostración', '--module', $module.id, '--owner', $frontend, '--priority', '70', '--token', $coordToken) |
  ConvertFrom-Json
Invoke-Orch @('task:assign', '--task', $task.id, '--agent', $frontend, '--token', $coordToken) | Out-Null

$info = Invoke-Orch @('message:send', '--project', $projectId, '--to', $coordinador, '--kind', 'INFO', '--correlation', 'corr-info', '--idempotency', 'idem-info', '--text', 'estado listo', '--token', $frontToken) |
  ConvertFrom-Json
$duplicate = Invoke-Orch @('message:send', '--project', $projectId, '--to', $coordinador, '--kind', 'INFO', '--correlation', 'corr-info', '--idempotency', 'idem-info', '--text', 'estado listo', '--token', $frontToken) |
  ConvertFrom-Json
Invoke-Orch @('message:send', '--project', $projectId, '--to', $coordinador, '--kind', 'ORDER', '--correlation', 'corr-denied', '--idempotency', 'idem-denied', '--text', 'orden no autorizada', '--token', $frontToken) 2>$null | Out-Null
$orderDenied = $LASTEXITCODE -ne 0

$state = Invoke-Orch @('state', '--project', $projectId, '--token', $frontToken) | ConvertFrom-Json
$rejected = Invoke-Orch @('rejected', '--project', $projectId, '--token', $human) | ConvertFrom-Json

[pscustomobject]@{
  projectId = $projectId
  agents = $agents.Count
  plan = $plan.id
  planHash = $plan.hash.Substring(0, 12)
  task = $task.id
  taskState = $state.tasks[0].state
  infoMessage = $info.message.id
  duplicateReturnedSameMessage = $duplicate.message.id -eq $info.message.id
  unauthorizedOrderDenied = $orderDenied
  rejectedOperations = $rejected.Count
  events = $state.events.Count
  modules = $state.modules.Count
} | ConvertTo-Json

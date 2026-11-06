param(
  [switch]$Reset
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if ($Reset) {
  $worktreePaths = @(git worktree list --porcelain | Where-Object { $_ -like 'worktree *' } | ForEach-Object { $_.Substring(9) })
  foreach ($path in $worktreePaths) {
    if ($path -ne $root) { git worktree remove --force $path 2>$null }
  }
  git worktree prune
  git branch --list 'orch/task/*' | ForEach-Object { git branch -D ($_.Trim()) 2>$null }
  Remove-Item -Recurse -Force (Join-Path $root '.worktrees') -ErrorAction SilentlyContinue
  Remove-Item -Force (Join-Path $root '.runtime/orchestrator.db*') -ErrorAction SilentlyContinue
}

function Invoke-Orch {
  param([string[]]$Arguments)
  & npx tsx src/cli.ts @Arguments
}

$human = (Invoke-Orch @('auth:issue', '--kind', 'HUMAN', '--subject', 'human') 2>$null | Select-Object -First 1).Trim()
Invoke-Orch @('db:migrate') | Out-Host

$project = Invoke-Orch @('project:create', '--name', 'Phase 3 Demo', '--repo', $root, '--token', $human) | ConvertFrom-Json
$projectId = $project.id
$agents = Invoke-Orch @('project:bootstrap', '--project', $projectId, '--token', $human) | ConvertFrom-Json
$coord = ($agents | Where-Object opencodeAgentId -eq 'coordinador').id
$front = ($agents | Where-Object opencodeAgentId -eq 'frontend').id
$back = ($agents | Where-Object opencodeAgentId -eq 'backend').id
$parent = ($agents | Where-Object opencodeAgentId -eq 'padre').id
$coordToken = (Invoke-Orch @('auth:issue', '--kind', 'AGENT', '--agent', $coord) 2>$null | Select-Object -First 1).Trim()
$parentToken = (Invoke-Orch @('auth:issue', '--kind', 'AGENT', '--agent', $parent) 2>$null | Select-Object -First 1).Trim()
$frontToken = (Invoke-Orch @('auth:issue', '--kind', 'AGENT', '--agent', $front) 2>$null | Select-Object -First 1).Trim()

$plan = Invoke-Orch @('plan:propose', '--project', $projectId, '--title', 'Phase 3 parallel plan', '--spec', '{"objective":"dos modulos independientes y uno dependiente"}', '--token', $parentToken) | ConvertFrom-Json
Invoke-Orch @('plan:approve', '--plan', $plan.id, '--hash', $plan.hash, '--token', $human) | Out-Null
Invoke-Orch @('project:start', '--project', $projectId, '--token', $human) | Out-Null

$modA = Invoke-Orch @('module:create', '--project', $projectId, '--name', 'phase3-frontend', '--owner', $front, '--paths', 'modules/frontend/**', '--token', $coordToken) | ConvertFrom-Json
$modB = Invoke-Orch @('module:create', '--project', $projectId, '--name', 'phase3-backend', '--owner', $back, '--paths', 'modules/backend/**', '--token', $coordToken) | ConvertFrom-Json

$taskA = Invoke-Orch @('task:create', '--project', $projectId, '--plan', $plan.id, '--title', 'Demo frontend module', '--description', 'Crea modules/frontend/demo.mjs que exporte add(a,b). Crea modules/frontend/demo.test.mjs usando node:assert para comprobar add(2,3)===5. No modifiques otros archivos y no uses shell. Responde DONE.', '--module', $modA.id, '--owner', $front, '--priority', '80', '--token', $coordToken) | ConvertFrom-Json
$taskB = Invoke-Orch @('task:create', '--project', $projectId, '--plan', $plan.id, '--title', 'Demo backend module', '--description', 'Crea modules/backend/demo.mjs que exporte multiply(a,b). Crea modules/backend/demo.test.mjs usando node:assert para comprobar multiply(3,4)===12. No modifiques otros archivos y no uses shell. Responde DONE.', '--module', $modB.id, '--owner', $back, '--priority', '80', '--token', $coordToken) | ConvertFrom-Json
$taskC = Invoke-Orch @('task:create', '--project', $projectId, '--plan', $plan.id, '--title', 'Dependent task', '--description', 'Tarea dependiente que no debe ejecutarse hasta que A esté aprobada.', '--module', $modA.id, '--owner', $front, '--priority', '10', '--depends', $taskA.id, '--token', $coordToken) | ConvertFrom-Json

Invoke-Orch @('contract:create', '--task', $taskA.id, '--module', $modA.id, '--objective', 'Implementar add y su test', '--paths', 'modules/frontend/**', '--inputs', 'add', '--outputs', 'number', '--tests', 'node modules/frontend/demo.test.mjs', '--limits', '{"maxDurationMinutes":10}', '--format', 'DeliveryDraft', '--token', $coordToken) | Out-Null
Invoke-Orch @('contract:create', '--task', $taskB.id, '--module', $modB.id, '--objective', 'Implementar multiply y su test', '--paths', 'modules/backend/**', '--inputs', 'multiply', '--outputs', 'number', '--tests', 'node modules/backend/demo.test.mjs', '--limits', '{"maxDurationMinutes":10}', '--format', 'DeliveryDraft', '--token', $coordToken) | Out-Null
Invoke-Orch @('contract:create', '--task', $taskC.id, '--module', $modA.id, '--objective', 'Tarea dependiente', '--paths', 'modules/frontend/**', '--inputs', 'none', '--outputs', 'none', '--tests', 'node modules/frontend/demo.test.mjs', '--limits', '{"maxDurationMinutes":10}', '--format', 'DeliveryDraft', '--token', $coordToken) | Out-Null

# El especialista intenta crear un contrato: debe ser denegado.
Invoke-Orch @('contract:create', '--task', $taskA.id, '--module', $modA.id, '--objective', 'Intento no autorizado', '--paths', 'modules/frontend/**', '--inputs', 'x', '--outputs', 'x', '--tests', 'node modules/frontend/demo.test.mjs', '--limits', '{"maxDurationMinutes":10}', '--format', 'DeliveryDraft', '--token', $frontToken) 2>$null | Out-Null
$unauthorizedContractDenied = $LASTEXITCODE -ne 0

$run = Invoke-Orch @('scheduler:run', '--project', $projectId, '--token', $human) | ConvertFrom-Json
$rejected = Invoke-Orch @('rejected', '--project', $projectId, '--token', $human) | ConvertFrom-Json
$state = Invoke-Orch @('state', '--project', $projectId, '--token', $human) | ConvertFrom-Json
$attempts = Invoke-Orch @('attempts:list', '--project', $projectId, '--token', $human) | ConvertFrom-Json

$startTimes = @($attempts | Where-Object { $_.startedAt } | ForEach-Object { [DateTime]$_.startedAt })
$endTimes = @($attempts | Where-Object { $_.endedAt } | ForEach-Object { [DateTime]$_.endedAt })
$overlap = $false
if ($startTimes.Count -ge 2 -and $endTimes.Count -ge 2) {
  $overlap = ($startTimes | Measure-Object -Maximum).Maximum -lt ($endTimes | Measure-Object -Minimum).Minimum
}

[pscustomobject]@{
  project = $projectId
  sessions = @($run.sessions).Count
  worktrees = @($run.worktrees).Count
  results = @($run.results | ForEach-Object { @{ task = $_.taskId; status = $_.status; session = $_.sessionId; commit = $_.commitSha } })
  taskStates = @($state.tasks | ForEach-Object { @{ id = $_.id; state = $_.state; owner = $_.ownerAgentId; deps = $_.dependencies } })
  moduleVersions = @($state.modules | ForEach-Object { @{ module = $_.name; versions = @($_.versions | ForEach-Object { @{ version = $_.version; commit = $_.commitSha; artifact = $_.artifactHash } }) } })
  attempts = @($attempts | ForEach-Object { @{ task = $_.taskId; attempt = $_.attempt; status = $_.status; started = $_.startedAt; ended = $_.endedAt } })
  concurrentOverlap = $overlap
  dependentTaskState = ($state.tasks | Where-Object { $_.id -eq $taskC.id }).state
  unauthorizedContractDenied = $unauthorizedContractDenied
  rejectedOperations = @($rejected).Count
  events = @($state.events).Count
} | ConvertTo-Json -Depth 8

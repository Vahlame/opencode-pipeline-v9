import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Command } from 'commander'
import { createAppContext } from '../app/context.js'
import type { AppContext } from '../app/context.js'
import { createOpenCodeAdapter } from '../opencode/factory.js'
import { WorktreeManager } from '../worktrees/manager.js'
import { RecoveryManager } from '../recovery/manager.js'
import { WorktreeMaintenance } from '../recovery/maintenance.js'
import type { MaintenanceResult } from '../recovery/maintenance.js'
import { DeliveryService } from '../integration/feedback.js'
import { detectHardware, runMathScript } from '../math/runner.js'
import { OutboxDispatcher, FileOutboxHandler, WebhookOutboxHandler } from '../outbox/index.js'
import { verifyArtifact } from '../security/signatures.js'
import type { Principal } from '../auth/types.js'
import type { ProjectId, TaskId } from '../domain/ids.js'
import { OrchestratorError } from '../orchestrator/errors.js'

type CliOptions = Record<string, string | boolean | number | undefined>

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function getString(options: CliOptions, key: string): string {
  const value = options[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new OrchestratorError('BAD_REQUEST', `--${key} is required`)
  }
  return value
}

function getNumber(options: CliOptions, key: string, fallback: number): number {
  const value = options[key]
  if (typeof value === 'string' && value.length > 0) return Number(value)
  if (typeof value === 'number') return value
  return fallback
}

function getLocal(options: CliOptions, key: string): string | undefined {
  const value = options[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function principal(context: AppContext, options: CliOptions): Principal {
  const token = getLocal(options, 'token') ?? process.env.ORCH_TOKEN
  if (!token) throw new OrchestratorError('UNAUTHORIZED', 'Use --token or ORCH_TOKEN')
  return context.tokens.verify(token)
}

function addToken(command: Command): Command {
  return command.option('--token <token>', 'token firmado del principal')
}

function addProject(command: Command): Command {
  return command.option('--project <id>', 'project ID')
}

function recoveryManager(
  context: AppContext,
  adapter: Awaited<ReturnType<typeof createOpenCodeAdapter>>,
): RecoveryManager {
  return new RecoveryManager(
    context.store,
    context.authz,
    new WorktreeManager(context.config.projectDir, context.config.worktreeRoot),
    {
      staleMinutes: context.config.ORCH_RECOVERY_STALE_MINUTES,
      taskMaxAttempts: context.config.ORCH_TASK_MAX_ATTEMPTS,
      leaseSeconds: context.config.ORCH_LEASE_SECONDS,
      operationLeaseSeconds: context.config.ORCH_OPERATION_LEASE_SECONDS,
    },
    adapter,
    context.resources,
  )
}

async function withAdapter(
  context: AppContext,
  action: (adapter: Awaited<ReturnType<typeof createOpenCodeAdapter>>) => Promise<void>,
): Promise<void> {
  const adapter = await createOpenCodeAdapter(context.config)
  try {
    await action(adapter)
  } finally {
    await adapter.close()
  }
}

export function buildStatusReport(context: AppContext, projectId: ProjectId) {
  const project = context.store.getProject(projectId)
  if (!project) throw new OrchestratorError('NOT_FOUND', `Project ${projectId} not found`, 404)
  const plans = context.store.listPlans(projectId)
  const tasks = context.store.listTasks(projectId)
  const dependencies = context.store.listDependenciesForProject(projectId)
  const depsByTask = new Map<string, string[]>()
  for (const dependency of dependencies) {
    const list = depsByTask.get(dependency.taskId) ?? []
    list.push(dependency.dependsOnTaskId)
    depsByTask.set(dependency.taskId, list)
  }
  const modules = context.store.listModules(projectId)
  const reviews = context.store.listReviews(projectId)
  const approved = context.store.listApprovedModules(projectId)
  const juryRuns = context.store.listJuryRuns(projectId)
  const consolidations = context.store.listConsolidations(projectId)
  const integrations = context.store.listIntegrationRuns(projectId)
  const manifests = context.store.listIntegrationManifests(projectId)
  const feedback = context.store.listFeedbackRuns(projectId)
  const deliveries = context.store.listFinalDeliveries(projectId)
  const recovery = context.store.listRecoveryRuns(projectId)
  const operations = context.store.listOperations(projectId)
  const resources = context.resources.snapshot(projectId)
  const exactUsage = context.store.sumProviderUsage(projectId)
  const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(project.status)
  const failures = [
    ...integrations
      .filter((run) => run.status === 'STRUCTURAL_FAILED' || run.status === 'FAILED')
      .map((run) => `${run.id}:${run.status}`),
    ...feedback.filter((run) => run.verdict === 'FAIL').map((run) => `${run.id}:FAIL`),
  ]
  const pendingTasks = tasks
    .filter((task) => task.state === 'PENDING' || task.state === 'READY')
    .map((task) => task.id)
  const blockers = [
    ...tasks
      .filter((task) => ['BLOCKED', 'FAILED', 'PAUSED'].includes(task.state))
      .map((task) => `${task.id}:${task.state}`),
    ...(!terminal ? failures : []),
    ...(!terminal && resources.exceeded.length > 0
      ? [`resources:${resources.exceeded.join(',')}`]
      : []),
  ]
  return {
    project,
    plans,
    tasks: tasks.map((task) => ({
      ...task,
      dependencies: depsByTask.get(task.id) ?? [],
    })),
    agents: context.store.listAgents(projectId),
    modules: modules.map((module) => ({
      ...module,
      versions: context.store.listModuleVersions(module.id),
    })),
    reviews,
    approved,
    juryRuns,
    consolidations,
    integrations,
    manifests,
    feedback,
    deliveries,
    recovery,
    operations,
    resources,
    exactUsage,
    messages: {
      queued: context.store.listProjectMessages(projectId, 'QUEUED').length,
      outboxPending: context.store.listOutboxForProject(projectId, 'PENDING').length,
    },
    blockers,
    failures,
    pendingTasks,
  }
}

type StatusReport = ReturnType<typeof buildStatusReport>

function printStatus(report: StatusReport): void {
  const { project } = report
  const plan = report.plans.find((candidate) => candidate.status === 'APPROVED') ?? report.plans[0]
  process.stdout.write(`Proyecto: ${project.name} [${project.status}] ${project.id}\n`)
  process.stdout.write(
    `Plan: ${plan ? `${plan.title} (${plan.status}, ${plan.hash.slice(0, 12)})` : 'sin plan'}\n`,
  )
  process.stdout.write(`Tareas: ${report.tasks.length}\n`)
  for (const task of report.tasks) {
    const deps = task.dependencies.length > 0 ? ` <- ${task.dependencies.join(', ')}` : ''
    process.stdout.write(`  [${task.state}] ${task.id} ${task.title}${deps}\n`)
  }
  process.stdout.write(`Agentes: ${report.agents.length}\n`)
  process.stdout.write(`Modulos: ${report.modules.length}\n`)
  for (const module of report.modules) {
    process.stdout.write(
      `  ${module.name} [${module.status}] versiones=${module.versions.length} current=${module.currentVersionId ?? 'none'}\n`,
    )
  }
  process.stdout.write(
    `Jurado: ${report.juryRuns.length} ejecuciones, ${report.reviews.length} dictamenes\n`,
  )
  const latestConsolidation = report.consolidations[0]
  if (latestConsolidation) {
    process.stdout.write(
      `  ultima consolidacion: ${latestConsolidation.verdict} ${latestConsolidation.id}\n`,
    )
  }
  process.stdout.write(
    `Integraciones: ${report.integrations.length} intentos, ${report.manifests.length} manifiestos\n`,
  )
  const latestManifest = report.manifests[0]
  if (latestManifest) {
    process.stdout.write(
      `  manifiesto: ${latestManifest.id} hash=${latestManifest.hash.slice(0, 16)} commit=${String(latestManifest.manifest['integrationCommit'] ?? '').slice(0, 12)}\n`,
    )
  }
  process.stdout.write(`Feedback: ${report.feedback.length} ejecuciones\n`)
  const latestFeedback = report.feedback[0]
  if (latestFeedback) {
    process.stdout.write(
      `  ultimo: ${latestFeedback.verdict ?? latestFeedback.status} ${latestFeedback.id}\n`,
    )
  }
  process.stdout.write(`Entregas: ${report.deliveries.length}\n`)
  for (const delivery of report.deliveries) {
    process.stdout.write(`  ${delivery.id} [${delivery.status}] manifest=${delivery.manifestId}\n`)
  }
  process.stdout.write(
    `Recursos: ${report.resources.totalTokens} tokens estimados, ${report.resources.estimatedCostUsd} USD, ${report.resources.elapsedMinutes} min\n`,
  )
  process.stdout.write(
    `Proveedor exacto: ${report.exactUsage.entries} registros, ${report.exactUsage.inputTokens + report.exactUsage.outputTokens} tokens, ${report.exactUsage.costUsd} USD\n`,
  )
  process.stdout.write(
    `Mensajes: ${report.messages.queued} encolados; outbox pendiente=${report.messages.outboxPending}\n`,
  )
  process.stdout.write(
    `Recuperaciones: ${report.recovery.length}; operaciones=${report.operations.length}\n`,
  )
  if (report.failures.length > 0) {
    process.stdout.write(`Historial de fallos: ${report.failures.join(', ')}\n`)
  }
  if (report.pendingTasks.length > 0) {
    process.stdout.write(`Trabajo pendiente: ${report.pendingTasks.join(', ')}\n`)
  }
  process.stdout.write(
    `Bloqueos: ${report.blockers.length === 0 ? 'ninguno' : report.blockers.join(', ')}\n`,
  )
}

function printRecovery(result: Awaited<ReturnType<RecoveryManager['run']>>): void {
  process.stdout.write(
    `Recuperacion ${result.run.id} [${result.run.mode}/${result.run.status}] hallazgos=${result.run.findingsCount} aplicados=${result.applied} reutilizada=${result.reused}\n`,
  )
  for (const action of result.actions) {
    process.stdout.write(
      `  [${action.status}] ${action.code} ${action.entityType}:${action.entityId ?? ''}\n`,
    )
  }
}

function escapeMarkdown(value: unknown): string {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ')
}

export function exportDeliveryMarkdown(context: AppContext, deliveryId: string): string {
  const service = new DeliveryService(context.store, context.authz)
  const delivery = service.get(deliveryId)
  const manifest = context.store.getIntegrationManifest(delivery.manifestId)
  const feedback = context.store.getFeedbackRun(delivery.feedbackId)
  if (!manifest || !feedback)
    throw new OrchestratorError('NOT_FOUND', 'Delivery evidence missing', 404)
  const signature = context.store.getArtifactSignature('FINAL_DELIVERY', delivery.id)
  const summary = delivery.summary
  const modules = Array.isArray(summary['modules'])
    ? (summary['modules'] as Array<Record<string, unknown>>)
    : []
  const adapters = Array.isArray(summary['adapters'])
    ? (summary['adapters'] as Array<Record<string, unknown>>)
    : []
  const criteria = Array.isArray(summary['criteria'])
    ? (summary['criteria'] as Array<Record<string, unknown>>)
    : []
  const tests = Array.isArray(summary['integrationTests'])
    ? (summary['integrationTests'] as Array<Record<string, unknown>>)
    : []
  const findings = Array.isArray(summary['findings'])
    ? (summary['findings'] as Array<Record<string, unknown>>)
    : []
  const lines: string[] = [
    `# Entrega final ${delivery.id}`,
    '',
    `- Proyecto: ${String(summary['projectName'] ?? delivery.projectId)}`,
    `- Estado: ${delivery.status}`,
    `- Manifiesto: ${delivery.manifestId}`,
    `- Hash del manifiesto: ${manifest.hash}`,
    `- Commit integrado: ${String(manifest.manifest['integrationCommit'] ?? '')}`,
    `- Feedback: ${feedback.id} (${feedback.verdict})`,
    `- Firma: ${signature ? `${signature.algorithm} ${signature.signature.slice(0, 24)}...` : 'sin firma'}`,
    `- Creada: ${delivery.createdAt}`,
    `- Entregada: ${delivery.deliveredAt ?? 'pendiente'}`,
    '',
    '## Plan aprobado',
    '',
    `- ${String((summary['plan'] as Record<string, unknown> | undefined)?.['title'] ?? '')}`,
    `- Hash: ${String((summary['plan'] as Record<string, unknown> | undefined)?.['hash'] ?? '')}`,
    '',
    '## Modulos',
    '',
    '| Modulo | Version | Commit | Artefacto |',
    '|---|---:|---|---|',
    ...modules.map(
      (module) =>
        `| ${escapeMarkdown(module['moduleName'])} | ${escapeMarkdown(module['version'])} | ${escapeMarkdown(module['commitSha'])} | ${escapeMarkdown(module['artifactHash'])} |`,
    ),
    '',
    '## Adaptadores',
    '',
    ...(adapters.length === 0
      ? ['Sin adaptadores.']
      : adapters.map(
          (adapter) =>
            `- ${escapeMarkdown(adapter['path'])} v${escapeMarkdown(adapter['version'])}`,
        )),
    '',
    '## Pruebas de integracion',
    '',
    ...tests.map(
      (test) =>
        `- [${test['passed'] === true ? 'PASS' : 'FAIL'}] ${escapeMarkdown(test['command'])} (exit ${escapeMarkdown(test['exitCode'])})`,
    ),
    '',
    '## Criterios',
    '',
    '| Criterio | Estado | Evidencia |',
    '|---|---|---|',
    ...criteria.map(
      (criterion) =>
        `| ${escapeMarkdown(criterion['id'])} | ${escapeMarkdown(criterion['status'])} | ${escapeMarkdown((criterion['evidence'] as string[] | undefined)?.length ?? 0)} |`,
    ),
    '',
    '## Hallazgos',
    '',
    ...(findings.length === 0
      ? ['Sin hallazgos.']
      : findings.map(
          (finding) =>
            `- [${escapeMarkdown(finding['severity'])}] ${escapeMarkdown(finding['message'])}`,
        )),
    '',
    '## Como verificar',
    '',
    '```text',
    ...((summary['howToVerify'] as string[] | undefined) ?? []),
    '```',
    '',
    '## Evidencia',
    '',
    ...((summary['evidence'] as string[] | undefined) ?? []).map((item) => `- ${item}`),
    '',
  ]
  return lines.join('\n')
}

export function registerPhase6Commands(program: Command): void {
  addProject(addToken(program.command('status')))
    .description('Muestra el estado completo del proyecto de forma legible')
    .option('--json', 'salida JSON estructurada')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const projectId = getString(options, 'project') as ProjectId
        context.authz.require(principal(context, options), 'state.read', {
          type: 'project',
          id: projectId,
        })
        const report = buildStatusReport(context, projectId)
        if (options.json === true) print(report)
        else printStatus(report)
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('usage')))
    .description('Muestra el uso estimado de tokens, coste y tiempo del proyecto')
    .option('--json', 'salida JSON')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const projectId = getString(options, 'project') as ProjectId
        context.authz.require(principal(context, options), 'resource.read', {
          type: 'project',
          id: projectId,
        })
        const snapshot = context.resources.snapshot(projectId)
        const exact = context.store.sumProviderUsage(projectId)
        if (options.json === true) print({ ...snapshot, exact })
        else {
          process.stdout.write(`Proyecto: ${projectId}\n`)
          process.stdout.write(`Inicio: ${snapshot.startedAt}\n`)
          process.stdout.write(`Tiempo: ${snapshot.elapsedMinutes} min\n`)
          process.stdout.write(
            `Tokens estimados: ${snapshot.totalTokens} (in=${snapshot.inputTokens}, out=${snapshot.outputTokens})\n`,
          )
          process.stdout.write(`Coste estimado: ${snapshot.estimatedCostUsd} USD\n`)
          process.stdout.write(
            `Proveedor exacto: ${exact.entries} registros, in=${exact.inputTokens}, out=${exact.outputTokens}, coste=${exact.costUsd} USD\n`,
          )
          process.stdout.write(`Limites superados: ${snapshot.exceeded.join(', ') || 'ninguno'}\n`)
        }
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('usage:breakdown')))
    .description('Desglosa tokens/coste por agente, tarea, sesion o proposito')
    .option('--by <group>', 'agent | task | session | purpose', 'agent')
    .option('--json', 'salida JSON')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const projectId = getString(options, 'project') as ProjectId
        context.authz.require(principal(context, options), 'resource.read', {
          type: 'project',
          id: projectId,
        })
        const by = (getLocal(options, 'by') ?? 'agent') as 'agent' | 'task' | 'session' | 'purpose'
        if (!['agent', 'task', 'session', 'purpose'].includes(by)) {
          throw new OrchestratorError('BAD_REQUEST', 'by must be agent, task, session or purpose')
        }
        const rows = context.store.usageBreakdown(projectId, by)
        if (options.json === true) print({ by, rows })
        else {
          process.stdout.write(`Uso por ${by}:\n`)
          for (const row of rows) {
            process.stdout.write(
              `  ${row.key} [${row.source}] in=${row.inputTokens} out=${row.outputTokens} coste=${row.costUsd} USD cambios=${row.entries}\n`,
            )
          }
          if (rows.length === 0) process.stdout.write('  Sin datos de uso.\n')
        }
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('usage:record')))
    .description('Importa uso exacto de tokens/coste reportado por el proveedor')
    .option('--provider <name>', 'proveedor')
    .option('--model <name>', 'modelo')
    .option('--request <id>', 'request ID del proveedor')
    .option('--input <n>', 'tokens de entrada')
    .option('--output <n>', 'tokens de salida')
    .option('--cost <usd>', 'coste exacto en USD')
    .option('--source <type>', 'provider | import | manual', 'import')
    .option('--agent <id>', 'agent ID')
    .option('--task <id>', 'task ID')
    .option('--session <id>', 'session ID')
    .option('--purpose <text>', 'proposito', 'provider-request')
    .option('--json', 'salida JSON')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const projectId = getString(options, 'project') as ProjectId
        context.authz.require(principal(context, options), 'resource.record', {
          type: 'project',
          id: projectId,
        })
        const record = context.store.recordProviderUsage({
          projectId,
          provider: getString(options, 'provider'),
          ...(getLocal(options, 'model') ? { model: getLocal(options, 'model')! } : {}),
          ...(getLocal(options, 'request') ? { requestId: getLocal(options, 'request')! } : {}),
          source: (getLocal(options, 'source') ?? 'import') as 'provider' | 'manual' | 'import',
          inputTokens: getNumber(options, 'input', 0),
          outputTokens: getNumber(options, 'output', 0),
          costUsd: getNumber(options, 'cost', 0),
        })
        context.store.createUsageEvent({
          projectId,
          ...(getLocal(options, 'agent') ? { agentId: getLocal(options, 'agent') as never } : {}),
          ...(getLocal(options, 'task') ? { taskId: getLocal(options, 'task') as never } : {}),
          ...(getLocal(options, 'session') ? { sessionId: getLocal(options, 'session')! } : {}),
          purpose: getLocal(options, 'purpose') ?? 'provider-request',
          source: 'provider',
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          costUsd: record.costUsd,
          ...(record.requestId ? { requestId: record.requestId } : {}),
        })
        if (options.json === true) print(record)
        else {
          process.stdout.write(
            `Uso registrado: ${record.provider} in=${record.inputTokens} out=${record.outputTokens} coste=${record.costUsd} USD\n`,
          )
        }
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('diagnostics')))
    .description('Ejecuta recuperacion en modo diagnostico sin modificar estado')
    .option('--json', 'salida JSON')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        await withAdapter(context, async (adapter) => {
          const findings = await recoveryManager(context, adapter).inspect(
            principal(context, options),
            getString(options, 'project') as ProjectId,
          )
          if (options.json === true) print(findings)
          else {
            process.stdout.write(`Diagnostico: ${findings.length} hallazgos\n`)
            for (const finding of findings) {
              process.stdout.write(
                `  [${finding.severity}] ${finding.code} ${finding.entityType}:${finding.entityId ?? ''}\n    ${finding.message}\n`,
              )
            }
          }
        })
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('recovery:run')))
    .description('Reconcilia sesiones, leases, tareas, worktrees, jurados e integraciones')
    .option('--apply', 'aplicar acciones recuperables')
    .option('--json', 'salida JSON')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        await withAdapter(context, async (adapter) => {
          const result = await recoveryManager(context, adapter).run(
            principal(context, options),
            getString(options, 'project') as ProjectId,
            { apply: options.apply === true },
          )
          if (options.json === true) print(result)
          else printRecovery(result)
        })
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('recovery:history')))
    .description('Lista ejecuciones de recuperacion y sus acciones')
    .option('--json', 'salida JSON')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const projectId = getString(options, 'project') as ProjectId
        context.authz.require(principal(context, options), 'recovery.read', {
          type: 'project',
          id: projectId,
        })
        const runs = context.store.listRecoveryRuns(projectId).map((run) => ({
          ...run,
          actions: context.store.listRecoveryActions(run.id),
        }))
        if (options.json === true) print(runs)
        else {
          for (const run of runs) {
            process.stdout.write(
              `${run.id} [${run.mode}/${run.status}] hallazgos=${run.findingsCount} aplicados=${run.appliedCount}\n`,
            )
            for (const action of run.actions) {
              process.stdout.write(
                `  [${action.status}] ${action.code} ${action.entityType}:${action.entityId ?? ''}\n`,
              )
            }
          }
          if (runs.length === 0) process.stdout.write('Sin recuperaciones registradas.\n')
        }
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('legacy:reconcile')))
    .description('Reconcilia una tarea legacy con aprobacion humana explicita')
    .option('--task <id>', 'task ID')
    .option('--decision <value>', 'cancel | requeue')
    .option('--confirm', 'confirmar la reconciliacion')
    .option('--json', 'salida JSON')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        if (options.confirm !== true) {
          throw new OrchestratorError(
            'CONFIRM_REQUIRED',
            'Usa --confirm para aprobar la reconciliacion',
          )
        }
        const task = context.store.getTask(getString(options, 'task') as TaskId)
        if (!task) throw new OrchestratorError('NOT_FOUND', 'Task not found', 404)
        context.authz.require(principal(context, options), 'legacy.reconcile', {
          type: 'project',
          id: task.projectId,
        })
        const decision = getString(options, 'decision')
        if (decision !== 'cancel' && decision !== 'requeue') {
          throw new OrchestratorError('BAD_REQUEST', 'decision must be cancel or requeue')
        }
        if (decision === 'requeue') {
          const project = context.store.getProject(task.projectId)
          if (!project || project.status !== 'RUNNING') {
            throw new OrchestratorError('CONFLICT', 'requeue requires a RUNNING project')
          }
        }
        const updated = context.store.transaction(() => {
          if (decision === 'cancel') {
            const result = context.store.updateTaskState(task.id, 'CANCELLED')
            const event = context.store.appendEvent({
              projectId: task.projectId,
              type: 'legacy.reconciled',
              aggregateType: 'task',
              aggregateId: task.id,
              actorId: principal(context, options).subjectId,
              payload: { taskId: task.id, decision, previousState: task.state },
            })
            context.store.appendOutbox(event.id, 'orchestrator.recovery', {
              eventId: event.id,
              type: event.type,
              aggregateId: event.aggregateId,
            })
            return result
          }
          const result = context.store.updateTaskState(task.id, 'READY')
          return result
        })
        if (options.json === true) print(updated)
        else process.stdout.write(`Tarea ${updated.id} reconciliada: ${updated.state}\n`)
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('maintenance:cleanup')))
    .description('Planifica o aplica limpieza de worktrees limpios con retencion')
    .option('--apply', 'eliminar worktrees/snapshots limpios')
    .option('--keep-days <n>', 'dias de retencion')
    .option('--json', 'salida JSON')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const projectId = getString(options, 'project') as ProjectId
        const apply = options.apply === true
        context.authz.require(
          principal(context, options),
          apply ? 'maintenance.cleanup' : 'maintenance.read',
          { type: 'project', id: projectId },
        )
        const service = new WorktreeMaintenance(
          context.store,
          new WorktreeManager(context.config.projectDir, context.config.worktreeRoot),
          getNumber(options, 'keepDays', context.config.ORCH_WORKTREE_RETENTION_DAYS),
        )
        const result = apply ? service.apply(projectId) : service.plan(projectId)
        if (options.json === true) print(result)
        else {
          process.stdout.write(
            `Mantenimiento ${result.dryRun ? 'DRY-RUN' : 'APLICADO'} keepDays=${result.keepDays}\n`,
          )
          for (const candidate of result.candidates) {
            process.stdout.write(`  ${candidate.kind}: ${candidate.path} (${candidate.reason})\n`)
          }
          for (const skipped of result.skipped) {
            process.stdout.write(`  SKIP ${skipped.path}: ${skipped.reason}\n`)
          }
          if (!result.dryRun) {
            const applied = result as MaintenanceResult
            process.stdout.write(`  Eliminados: ${applied.removed.length}\n`)
            for (const failed of applied.failed) {
              process.stdout.write(`  FALLO ${failed.path}: ${failed.error}\n`)
            }
          }
        }
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('outbox:dispatch')))
    .description('Entrega eventos pendientes por archivo o webhook')
    .option('--transport <type>', 'file | webhook', 'file')
    .option('--target <value>', 'ruta o URL')
    .option('--limit <n>', 'maximo de eventos', '100')
    .option('--json', 'salida JSON')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const projectId = getString(options, 'project') as ProjectId
        context.authz.require(principal(context, options), 'outbox.dispatch', {
          type: 'project',
          id: projectId,
        })
        const transport = getLocal(options, 'transport') ?? 'file'
        const target =
          getLocal(options, 'target') ??
          resolve(context.config.projectDir, '.runtime/outbox.ndjson')
        const handler =
          transport === 'webhook'
            ? new WebhookOutboxHandler(target)
            : transport === 'file'
              ? new FileOutboxHandler(target)
              : undefined
        if (!handler) throw new OrchestratorError('BAD_REQUEST', 'unsupported outbox transport')
        const dispatcher = new OutboxDispatcher(context.store, handler)
        const result = await dispatcher.dispatch(getNumber(options, 'limit', 100))
        if (options.json === true) print(result)
        else {
          process.stdout.write(
            `Outbox: ${result.delivered} entregados, ${result.retried} reintentos, ${result.failed} fallidos\n`,
          )
        }
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('math:run')))
    .description('Ejecuta un script matematico con el interprete mas adecuado al hardware')
    .option('--script <file>', 'script .py/.mjs/.js')
    .option('--interpreter <name>', 'auto | python | node', 'auto')
    .option('--timeout <ms>', 'timeout')
    .option('--json', 'salida JSON')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const projectId = getString(options, 'project') as ProjectId
        context.authz.require(principal(context, options), 'resource.read', {
          type: 'project',
          id: projectId,
        })
        const result = runMathScript({
          script: getString(options, 'script'),
          repositoryRoot: context.config.projectDir,
          interpreter: (getLocal(options, 'interpreter') ?? 'auto') as 'auto' | 'python' | 'node',
          ...(options.timeout ? { timeoutMs: getNumber(options, 'timeout', 300_000) } : {}),
        })
        if (options.json === true) print(result)
        else {
          process.stdout.write(
            `Math ${result.passed ? 'PASS' : 'FAIL'} · ${result.command} · ${result.durationMs} ms\n`,
          )
          process.stdout.write(
            `Hardware: ${result.hardware.cpuModel} (${result.hardware.cpuCores} cores, ${result.hardware.memoryGb} GB)\n`,
          )
          process.stdout.write(result.stdout)
          if (result.stderr) process.stderr.write(result.stderr)
        }
        if (!result.passed) process.exitCode = 1
      } finally {
        context.close()
      }
    })

  addToken(program.command('math:hardware'))
    .description('Muestra el hardware detectado y el interprete recomendado')
    .option('--json', 'salida JSON')
    .action(async (options: CliOptions) => {
      const hardware = detectHardware()
      if (options.json === true) print(hardware)
      else {
        process.stdout.write(`Plataforma: ${hardware.platform}/${hardware.arch}\n`)
        process.stdout.write(`CPU: ${hardware.cpuModel} (${hardware.cpuCores} cores)\n`)
        process.stdout.write(`Memoria: ${hardware.memoryGb} GB\n`)
        process.stdout.write(`Interprete recomendado: ${hardware.recommendedInterpreter}\n`)
      }
    })

  addToken(program.command('delivery:verify'))
    .description('Verifica la firma HMAC de una entrega final')
    .option('--delivery <id>', 'delivery ID')
    .option('--json', 'salida JSON')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const delivery = context.store.getFinalDelivery(getString(options, 'delivery'))
        if (!delivery) throw new OrchestratorError('NOT_FOUND', 'Delivery not found', 404)
        context.authz.require(principal(context, options), 'delivery.read', {
          type: 'project',
          id: delivery.projectId,
        })
        const signature = context.store.getArtifactSignature('FINAL_DELIVERY', delivery.id)
        const feedback = context.store.getFeedbackRun(delivery.feedbackId)
        const manifest = context.store.getIntegrationManifest(delivery.manifestId)
        const valid = Boolean(
          signature &&
          feedback &&
          manifest &&
          context.config.ORCH_AUTH_SECRET &&
          verifyArtifact(
            {
              subjectType: 'FINAL_DELIVERY',
              subjectId: delivery.id,
              projectId: delivery.projectId,
              manifestId: delivery.manifestId,
              manifestHash: manifest!.hash,
              feedbackId: feedback!.id,
              feedbackHash: feedback!.hash,
            },
            signature.signature,
            context.config.ORCH_AUTH_SECRET,
          ),
        )
        if (options.json === true) print({ valid, signature })
        else {
          process.stdout.write(
            valid
              ? 'Firma valida: entrega autentica.\n'
              : 'Firma invalida o ausente; no confies en el artefacto.\n',
          )
        }
        if (!valid) process.exitCode = 1
      } finally {
        context.close()
      }
    })

  addToken(program.command('delivery:export'))
    .description('Exporta la entrega final a Markdown legible')
    .option('--delivery <id>', 'delivery ID')
    .option('--output <file>', 'archivo de salida')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const deliveryId = getString(options, 'delivery')
        const delivery = context.store.getFinalDelivery(deliveryId)
        if (!delivery) throw new OrchestratorError('NOT_FOUND', 'Delivery not found', 404)
        context.authz.require(principal(context, options), 'delivery.read', {
          type: 'project',
          id: delivery.projectId,
        })
        const output = resolve(getLocal(options, 'output') ?? `.runtime/delivery-${delivery.id}.md`)
        mkdirSync(dirname(output), { recursive: true })
        writeFileSync(output, exportDeliveryMarkdown(context, deliveryId), 'utf8')
        print({ delivery: delivery.id, output, exists: existsSync(output) })
      } finally {
        context.close()
      }
    })
}

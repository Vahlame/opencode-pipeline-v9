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
import type { Principal } from '../auth/types.js'
import type { ProjectId } from '../domain/ids.js'
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
        if (options.json === true) print(snapshot)
        else {
          process.stdout.write(`Proyecto: ${projectId}\n`)
          process.stdout.write(`Inicio: ${snapshot.startedAt}\n`)
          process.stdout.write(`Tiempo: ${snapshot.elapsedMinutes} min\n`)
          process.stdout.write(
            `Tokens estimados: ${snapshot.totalTokens} (in=${snapshot.inputTokens}, out=${snapshot.outputTokens})\n`,
          )
          process.stdout.write(`Coste estimado: ${snapshot.estimatedCostUsd} USD\n`)
          process.stdout.write(`Limites superados: ${snapshot.exceeded.join(', ') || 'ninguno'}\n`)
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

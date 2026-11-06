import type { Command } from 'commander'
import { createAppContext } from '../app/context.js'
import type { AppContext } from '../app/context.js'
import { createOpenCodeAdapter } from '../opencode/factory.js'
import type { ModelReference } from '../opencode/adapter.js'
import { parseModelRef } from '../config/env.js'
import { WorktreeManager } from '../worktrees/manager.js'
import { SessionManager } from '../sessions/manager.js'
import { TaskExecutor } from '../orchestrator/task-executor.js'
import { Scheduler } from '../orchestrator/scheduler.js'
import { OrchestratorError } from '../orchestrator/errors.js'
import type { Principal } from '../auth/types.js'
import type { ProjectId } from '../domain/ids.js'

type CliOptions = Record<string, string | boolean | number | undefined>

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function getString(options: CliOptions, key: string): string {
  const value = options[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new OrchestratorError('BAD_REQUEST', `--${key} is required`)
  }
  return value
}

function getOptionalString(options: CliOptions, key: string): string | undefined {
  const value = options[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function decode(context: AppContext, options: CliOptions): Principal {
  const token = getOptionalString(options, 'token') ?? process.env.ORCH_TOKEN
  if (!token) throw new OrchestratorError('UNAUTHORIZED', 'Use --token or ORCH_TOKEN')
  return context.tokens.verify(token)
}

function model(config: AppContext['config']): ModelReference | undefined {
  return parseModelRef(config.ORCH_AGENT_MODEL ?? config.OPENCODE_MODEL)
}

function addToken(command: Command): Command {
  return command.option('--token <token>', 'token firmado del principal')
}

function addProject(command: Command): Command {
  return command.option('--project <id>', 'project ID')
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

export function registerPhase3Commands(program: Command): void {
  addProject(addToken(program.command('scheduler:run')))
    .description('Reclama y ejecuta tareas READY en paralelo usando sesiones OpenCode reales')
    .option('--max-parallel <n>', 'límite de concurrencia')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        await withAdapter(context, async (adapter) => {
          const principal = decode(context, options)
          const projectId = getString(options, 'project') as ProjectId
          const maxParallelLimit = Math.min(
            context.config.ORCH_MAX_PARALLEL,
            context.config.ORCH_MAX_AGENTS,
          )
          const maxParallel =
            typeof options.maxParallel === 'string'
              ? Math.min(Number(options.maxParallel), maxParallelLimit)
              : maxParallelLimit
          if (!Number.isFinite(maxParallel) || maxParallel < 1) {
            throw new OrchestratorError('BAD_REQUEST', '--max-parallel must be a positive number')
          }
          const worktrees = new WorktreeManager(
            context.config.projectDir,
            context.config.worktreeRoot,
          )
          const sessions = new SessionManager(context.store, adapter, context.resources)
          const executor = new TaskExecutor(
            context.store,
            context.service,
            worktrees,
            sessions,
            context.config,
            context.resources,
          )
          const scheduler = new Scheduler(
            context.store,
            context.authz,
            executor,
            {
              maxParallel,
              leaseSeconds: context.config.ORCH_LEASE_SECONDS,
              taskMaxAttempts: context.config.ORCH_TASK_MAX_ATTEMPTS,
            },
            context.resources,
          )
          const results = await scheduler.runOnce(principal, projectId)
          output({
            results,
            sessions: context.store.listSessions(projectId),
            worktrees: context.store.listWorktrees(projectId),
            model: model(context.config) ?? null,
          })
        })
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('scheduler:recover')))
    .description('Recupera leases expirados de un proyecto')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        await withAdapter(context, async (adapter) => {
          const principal = decode(context, options)
          const worktrees = new WorktreeManager(
            context.config.projectDir,
            context.config.worktreeRoot,
          )
          const sessions = new SessionManager(context.store, adapter, context.resources)
          const executor = new TaskExecutor(
            context.store,
            context.service,
            worktrees,
            sessions,
            context.config,
            context.resources,
          )
          const scheduler = new Scheduler(
            context.store,
            context.authz,
            executor,
            {
              maxParallel: Math.min(
                context.config.ORCH_MAX_PARALLEL,
                context.config.ORCH_MAX_AGENTS,
              ),
              leaseSeconds: context.config.ORCH_LEASE_SECONDS,
              taskMaxAttempts: context.config.ORCH_TASK_MAX_ATTEMPTS,
            },
            context.resources,
          )
          output({
            recovered: scheduler.recoverExpiredLeases(
              principal,
              getString(options, 'project') as ProjectId,
            ),
          })
        })
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('sessions:list')))
    .description('Lista sesiones persistidas de un proyecto')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const principal = decode(context, options)
        const projectId = getString(options, 'project') as ProjectId
        context.authz.require(principal, 'state.read', { type: 'project', id: projectId })
        output(context.store.listSessions(projectId))
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('worktrees:list')))
    .description('Lista worktrees y sus commits')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const principal = decode(context, options)
        const projectId = getString(options, 'project') as ProjectId
        context.authz.require(principal, 'state.read', { type: 'project', id: projectId })
        output(context.store.listWorktrees(projectId))
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('attempts:list')))
    .description('Lista intentos de ejecución de las tareas')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const principal = decode(context, options)
        const projectId = getString(options, 'project') as ProjectId
        context.authz.require(principal, 'state.read', { type: 'project', id: projectId })
        const attempts = context.store
          .listTasks(projectId)
          .flatMap((task) => context.store.listTaskAttempts(task.id))
        output(attempts)
      } finally {
        context.close()
      }
    })

  addToken(program.command('session:stop'))
    .description('Detiene una sesión autorizada de OpenCode')
    .option('--session <id>', 'session persistida')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        await withAdapter(context, async (adapter) => {
          const principal = decode(context, options)
          const sessionId = getString(options, 'session')
          const record = context.store.getSession(sessionId)
          if (!record)
            throw new OrchestratorError('NOT_FOUND', `Session ${sessionId} not found`, 404)
          context.authz.require(principal, 'session.interrupt', {
            type: 'session',
            id: record.id,
          })
          const sessions = new SessionManager(context.store, adapter, context.resources)
          await sessions.interrupt(record)
          output({ stopped: record.id })
        })
      } finally {
        context.close()
      }
    })
}

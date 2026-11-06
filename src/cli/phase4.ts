import type { Command } from 'commander'
import { createAppContext } from '../app/context.js'
import type { AppContext } from '../app/context.js'
import { createOpenCodeAdapter } from '../opencode/factory.js'
import { WorktreeManager } from '../worktrees/manager.js'
import { SessionManager } from '../sessions/manager.js'
import { OpenCodeJudgeExecutor, JuryService } from '../jury/runner.js'
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

async function withRuntime(
  context: AppContext,
  action: (deps: {
    adapter: Awaited<ReturnType<typeof createOpenCodeAdapter>>
    sessions: SessionManager
    worktrees: WorktreeManager
    jury: JuryService
  }) => Promise<void>,
): Promise<void> {
  const adapter = await createOpenCodeAdapter(context.config)
  try {
    const worktrees = new WorktreeManager(context.config.projectDir, context.config.worktreeRoot)
    const sessions = new SessionManager(context.store, adapter)
    const judgeExecutor = new OpenCodeJudgeExecutor(context.store, sessions, context.config)
    const jury = new JuryService(
      context.store,
      context.authz,
      worktrees,
      judgeExecutor,
      context.config,
    )
    await action({ adapter, sessions, worktrees, jury })
  } finally {
    await adapter.close()
  }
}

export function registerPhase4Commands(program: Command): void {
  addToken(program.command('jury:run'))
    .description('Ejecuta los cuatro jueces y consolida el veredicto de una tarea IN_REVIEW')
    .option('--task <id>', 'task ID')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        await withRuntime(context, async ({ jury }) => {
          const result = await jury.run(
            principal(context, options),
            getString(options, 'task') as TaskId,
          )
          print({
            run: result.run,
            reviews: result.reviews,
            consolidation: result.consolidation,
            decision: result.decision,
          })
        })
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('jury:runs')))
    .description('Lista ejecuciones de jurado')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const projectId = getString(options, 'project') as ProjectId
        context.authz.require(principal(context, options), 'jury.read', {
          type: 'project',
          id: projectId,
        })
        print(context.store.listJuryRuns(projectId))
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('jury:consolidations')))
    .description('Lista consolidaciones del jurado')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const projectId = getString(options, 'project') as ProjectId
        context.authz.require(principal(context, options), 'jury.read', {
          type: 'project',
          id: projectId,
        })
        print(context.store.listConsolidations(projectId))
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('jury:approved')))
    .description('Lista módulos aprobados')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const projectId = getString(options, 'project') as ProjectId
        context.authz.require(principal(context, options), 'jury.read', {
          type: 'project',
          id: projectId,
        })
        print(context.store.listApprovedModules(projectId))
      } finally {
        context.close()
      }
    })
}

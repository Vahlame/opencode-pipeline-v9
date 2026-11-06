import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Command } from 'commander'
import { createAppContext } from '../app/context.js'
import type { AppContext } from '../app/context.js'
import { createOpenCodeAdapter } from '../opencode/factory.js'
import { WorktreeManager } from '../worktrees/manager.js'
import { SessionManager } from '../sessions/manager.js'
import {
  GitIntegrationWorkspace,
  IntegrationManager,
  OpenCodeAdapterAuthor,
  type AdapterAuthor,
  type IntegrationRequest,
} from '../integration/index.js'
import { FeedbackService, OpenCodeFeedbackExecutor, DeliveryService } from '../integration/index.js'
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

function readRequest(path: string): IntegrationRequest {
  const absolute = resolve(path)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8'))
  } catch (error) {
    throw new OrchestratorError(
      'BAD_REQUEST',
      `Cannot read integration request ${absolute}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return parsed as IntegrationRequest
}

function integrationManager(
  context: AppContext,
  adapterAuthor?: AdapterAuthor,
): IntegrationManager {
  const worktrees = new WorktreeManager(context.config.projectDir, context.config.worktreeRoot)
  const workspace = new GitIntegrationWorkspace(
    worktrees,
    context.config.ORCH_INTEGRATION_TIMEOUT_MS,
  )
  return new IntegrationManager(
    context.store,
    context.authz,
    workspace,
    {
      baseRef: context.config.ORCH_GIT_BASE_REF,
      testsTimeoutMs: context.config.ORCH_INTEGRATION_TIMEOUT_MS,
      worktreeRoot: context.config.worktreeRoot,
      maxAttempts: context.config.ORCH_MAX_INTEGRATION_ATTEMPTS,
      resources: context.resources,
      ...(context.config.ORCH_AUTH_SECRET
        ? { signingSecret: context.config.ORCH_AUTH_SECRET }
        : {}),
    },
    adapterAuthor,
  )
}

export function registerPhase5Commands(program: Command): void {
  addToken(program.command('integration:run'))
    .description('Ensambla versiones aprobadas en un workspace aislado y produce un manifiesto')
    .option('--input <file>', 'JSON con la solicitud de integracion')
    .option('--agent-adapter', 'permite que el agente integrador proponga un adaptador menor')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const request = readRequest(getString(options, 'input'))
        if (options.agentAdapter === true) {
          const adapter = await createOpenCodeAdapter(context.config)
          try {
            const sessions = new SessionManager(context.store, adapter, context.resources)
            const author = new OpenCodeAdapterAuthor(context.store, sessions, context.config)
            const result = await integrationManager(context, author).run(
              principal(context, options),
              request,
            )
            print(result)
          } finally {
            await adapter.close()
          }
          return
        }
        const result = await integrationManager(context).run(principal(context, options), request)
        print(result)
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('integration:runs')))
    .description('Lista intentos de integracion')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const projectId = getString(options, 'project') as ProjectId
        context.authz.require(principal(context, options), 'integration.read', {
          type: 'project',
          id: projectId,
        })
        print(context.store.listIntegrationRuns(projectId))
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('integration:manifests')))
    .description('Lista manifiestos de integracion')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const projectId = getString(options, 'project') as ProjectId
        context.authz.require(principal(context, options), 'integration.read', {
          type: 'project',
          id: projectId,
        })
        print(context.store.listIntegrationManifests(projectId))
      } finally {
        context.close()
      }
    })

  addToken(program.command('integration:show'))
    .description('Muestra un manifiesto de integracion')
    .option('--manifest <id>', 'manifest ID')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const manifest = context.store.getIntegrationManifest(getString(options, 'manifest'))
        if (!manifest) throw new OrchestratorError('NOT_FOUND', 'Manifest not found', 404)
        context.authz.require(principal(context, options), 'integration.read', {
          type: 'project',
          id: manifest.projectId,
        })
        print({
          manifest,
          run: context.store.getIntegrationRun(manifest.runId),
          modules: context.store.listIntegrationModules(manifest.runId),
          adapters: context.store.listIntegrationAdapters(manifest.runId),
          conflicts: context.store.listIntegrationConflicts(manifest.runId),
        })
      } finally {
        context.close()
      }
    })

  addToken(program.command('feedback:run'))
    .description('Ejecuta el agente Feedback global sobre un manifiesto integrado')
    .option('--manifest <id>', 'manifest ID')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      const adapter = await createOpenCodeAdapter(context.config)
      try {
        const manifestId = getString(options, 'manifest')
        const manifest = context.store.getIntegrationManifest(manifestId)
        if (!manifest) throw new OrchestratorError('NOT_FOUND', 'Manifest not found', 404)
        const worktrees = new WorktreeManager(
          context.config.projectDir,
          context.config.worktreeRoot,
        )
        const sessions = new SessionManager(context.store, adapter, context.resources)
        const executor = new OpenCodeFeedbackExecutor(context.store, sessions, context.config)
        const service = new FeedbackService(
          context.store,
          context.authz,
          worktrees,
          executor,
          context.config.ORCH_AUTH_SECRET,
        )
        const result = await service.run(principal(context, options), manifestId)
        print(result)
      } finally {
        await adapter.close()
        context.close()
      }
    })

  addProject(addToken(program.command('feedback:runs')))
    .description('Lista evaluaciones globales')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const projectId = getString(options, 'project') as ProjectId
        context.authz.require(principal(context, options), 'feedback.read', {
          type: 'project',
          id: projectId,
        })
        print(context.store.listFeedbackRuns(projectId))
      } finally {
        context.close()
      }
    })

  addProject(addToken(program.command('deliveries:list')))
    .description('Lista entregas finales preparadas')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const projectId = getString(options, 'project') as ProjectId
        context.authz.require(principal(context, options), 'delivery.read', {
          type: 'project',
          id: projectId,
        })
        print(context.store.listFinalDeliveries(projectId))
      } finally {
        context.close()
      }
    })

  addToken(program.command('delivery:show'))
    .description('Muestra una entrega final')
    .option('--delivery <id>', 'delivery ID')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const delivery = context.store.getFinalDelivery(getString(options, 'delivery'))
        if (!delivery) throw new OrchestratorError('NOT_FOUND', 'Delivery not found', 404)
        context.authz.require(principal(context, options), 'delivery.read', {
          type: 'project',
          id: delivery.projectId,
        })
        print(delivery)
      } finally {
        context.close()
      }
    })

  addToken(program.command('delivery:finalize'))
    .description('Marca una entrega READY como entregada; requiere aprobacion humana')
    .option('--delivery <id>', 'delivery ID')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      try {
        const service = new DeliveryService(context.store, context.authz)
        print(service.finalize(principal(context, options), getString(options, 'delivery')))
      } finally {
        context.close()
      }
    })
}

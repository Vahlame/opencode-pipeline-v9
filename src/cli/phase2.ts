import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import { createAppContext } from '../app/context.js'
import type { AppContext } from '../app/context.js'
import { loadConfig } from '../config/env.js'
import { startApiServer } from '../api/server.js'
import { SqliteStore } from '../persistence/store.js'
import type {
  AgentId,
  MessageId,
  ModuleId,
  ModuleVersionId,
  PlanId,
  ProjectId,
  TaskId,
} from '../domain/ids.js'
import type { MessageKind } from '../domain/enums.js'
import type { Principal } from '../auth/types.js'
import { JUDGE_ROLES } from '../auth/types.js'
import { OrchestratorError } from '../orchestrator/errors.js'

type CliOptions = Record<string, string | boolean | number | undefined>

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function getString(options: CliOptions, key: string, required = true): string {
  const value = options[key]
  if (typeof value !== 'string' || value.length === 0) {
    if (required) throw new OrchestratorError('BAD_REQUEST', `--${key} is required`)
    return ''
  }
  return value
}

function getOptionalString(options: CliOptions, key: string): string | undefined {
  const value = options[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function getNumber(options: CliOptions, key: string, fallback?: number): number {
  const value = options[key]
  if (value === undefined || value === '') {
    if (fallback === undefined) throw new OrchestratorError('BAD_REQUEST', `--${key} is required`)
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed))
    throw new OrchestratorError('BAD_REQUEST', `--${key} must be a number`)
  return parsed
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('must be a JSON object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    throw new OrchestratorError(
      'BAD_REQUEST',
      `--${label} must be a valid JSON object: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function readJsonArgument(value: string, label: string): Record<string, unknown> {
  if (value.startsWith('@')) return parseJsonOption(readFileSync(value.slice(1), 'utf8'), label)
  return parseJsonOption(value, label)
}

function parseList(value: string | undefined): string[] {
  return value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

function decodeToken(context: AppContext, options: CliOptions): Principal {
  const token = getOptionalString(options, 'token') ?? process.env.ORCH_TOKEN
  if (!token) throw new OrchestratorError('UNAUTHORIZED', 'Use --token or ORCH_TOKEN')
  return context.tokens.verify(token)
}

async function withContext(action: (context: AppContext) => Promise<void> | void): Promise<void> {
  const context = createAppContext()
  try {
    await action(context)
  } finally {
    context.close()
  }
}

function addToken(command: Command): Command {
  return command.option('--token <token>', 'token firmado del principal')
}

function addProject(command: Command): Command {
  return command.option('--project <id>', 'project ID')
}

export function registerPhase2Commands(program: Command): void {
  program
    .command('auth:issue')
    .description('Emite un token firmado para humano o agente (operación de administrador local)')
    .option('--kind <kind>', 'HUMAN | AGENT | SYSTEM', 'HUMAN')
    .option('--subject <id>', 'identidad del humano', 'human')
    .option('--role <role>', 'rol para HUMAN/SYSTEM')
    .option('--project <id>', 'project ID')
    .option('--agent <id>', 'agent ID para kind=AGENT')
    .option('--ttl <seconds>', 'vigencia en segundos', '3600')
    .action(async (options: CliOptions) => {
      await withContext(async (context) => {
        const kind = getString(options, 'kind').toUpperCase()
        const ttl = getNumber(options, 'ttl', 3600)
        let principal: Principal
        if (kind === 'AGENT') {
          const agentId = getString(options, 'agent') as AgentId
          const agent = context.store.getAgent(agentId)
          if (!agent) throw new OrchestratorError('NOT_FOUND', `Agent ${agentId} not found`, 404)
          principal = {
            subjectId: agent.id,
            kind: 'AGENT',
            role: agent.role,
            projectId: agent.projectId,
            agentId: agent.id,
          }
        } else if (kind === 'HUMAN') {
          principal = {
            subjectId: getString(options, 'subject'),
            kind: 'HUMAN',
            role: 'HUMAN',
            ...(getOptionalString(options, 'project')
              ? { projectId: getOptionalString(options, 'project') }
              : {}),
          }
        } else if (kind === 'SYSTEM') {
          principal = { subjectId: 'system', kind: 'SYSTEM', role: 'SYSTEM' }
        } else {
          throw new OrchestratorError('BAD_REQUEST', '--kind must be HUMAN, AGENT or SYSTEM')
        }
        const token = context.tokens.issue(principal, ttl)
        process.stdout.write(`${token}\n`)
        process.stderr.write('Token emitido. No lo compartas ni lo incluyas en prompts o logs.\n')
      })
    })

  program
    .command('db:migrate')
    .description('Aplica migraciones SQLite y muestra la versión del esquema')
    .action(() => {
      const config = loadConfig()
      const store = SqliteStore.open(config.dbPath)
      try {
        printJson({
          dbPath: config.dbPath,
          schemaVersion: store.schemaVersion,
          projects: store.countTable('projects'),
          events: store.countTable('events'),
        })
      } finally {
        store.close()
      }
    })

  addToken(program.command('project:create'))
    .description('Crea un proyecto')
    .option('--name <name>', 'nombre')
    .option('--repo <path>', 'ruta canónica del repositorio')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        const principal = decodeToken(context, options)
        printJson(
          context.service.createProject(principal, {
            name: getString(options, 'name'),
            repoPath: getString(options, 'repo'),
          }),
        )
      })
    })

  addToken(program.command('project:list'))
    .description('Lista proyectos visibles para el principal')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(context.service.listProjects(decodeToken(context, options)))
      })
    })

  addProject(addToken(program.command('project:bootstrap')))
    .description('Registra los 11 agentes base del proyecto')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.bootstrapAgents(
            decodeToken(context, options),
            getString(options, 'project') as ProjectId,
          ),
        )
      })
    })

  for (const action of ['start', 'pause', 'resume', 'cancel'] as const) {
    addProject(addToken(program.command(`project:${action}`)))
      .description(`${action} project`)
      .action(async (options: CliOptions) => {
        await withContext((context) => {
          const principal = decodeToken(context, options)
          const projectId = getString(options, 'project') as ProjectId
          const method = {
            start: context.service.startProject.bind(context.service),
            pause: context.service.pauseProject.bind(context.service),
            resume: context.service.resumeProject.bind(context.service),
            cancel: context.service.cancelProject.bind(context.service),
          }[action]
          printJson(method(principal, projectId))
        })
      })
  }

  addProject(addToken(program.command('plan:propose')))
    .description('Propone un plan versionado')
    .option('--title <title>', 'título')
    .option('--spec <json>', 'especificación JSON, o @archivo.json')
    .option('--plan <json>', 'plan JSON, o @archivo.json')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        const spec = readJsonArgument(getString(options, 'spec'), 'spec')
        const plan = getOptionalString(options, 'plan')
          ? readJsonArgument(getString(options, 'plan'), 'plan')
          : spec
        printJson(
          context.service.createPlan(decodeToken(context, options), {
            projectId: getString(options, 'project') as ProjectId,
            title: getString(options, 'title'),
            spec,
            plan,
          }),
        )
      })
    })

  addToken(program.command('plan:approve'))
    .description('Aprueba un plan; requiere un principal HUMAN')
    .option('--plan <id>', 'plan ID')
    .option('--hash <hash>', 'hash exacto del plan')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.approvePlan(
            decodeToken(context, options),
            getString(options, 'plan') as PlanId,
            getString(options, 'hash'),
          ),
        )
      })
    })

  addProject(addToken(program.command('plan:list')))
    .description('Lista planes del proyecto')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.listPlans(
            decodeToken(context, options),
            getString(options, 'project') as ProjectId,
          ),
        )
      })
    })

  addProject(addToken(program.command('task:create')))
    .description('Crea una tarea y sus dependencias')
    .option('--plan <id>', 'plan aprobado')
    .option('--title <title>', 'título')
    .option('--description <text>', 'descripción')
    .option('--module <id>', 'module ID')
    .option('--owner <id>', 'agent ID')
    .option('--priority <n>', 'prioridad 0-100')
    .option('--depends <ids>', 'IDs separados por coma')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        const module = getOptionalString(options, 'module')
        const owner = getOptionalString(options, 'owner')
        printJson(
          context.service.createTask(decodeToken(context, options), {
            projectId: getString(options, 'project') as ProjectId,
            planId: getString(options, 'plan') as PlanId,
            title: getString(options, 'title'),
            description: getString(options, 'description'),
            ...(module ? { moduleId: module as ModuleId } : {}),
            ...(owner ? { ownerAgentId: owner as AgentId } : {}),
            ...(options.priority !== undefined ? { priority: getNumber(options, 'priority') } : {}),
            dependsOn: parseList(getOptionalString(options, 'depends')) as TaskId[],
          }),
        )
      })
    })

  addProject(addToken(program.command('task:list')))
    .description('Lista tareas')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.listTasks(
            decodeToken(context, options),
            getString(options, 'project') as ProjectId,
          ),
        )
      })
    })

  addToken(program.command('task:assign'))
    .description('Asigna o reasigna una tarea')
    .option('--task <id>', 'task ID')
    .option('--agent <id>', 'owner agent ID')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.assignTask(
            decodeToken(context, options),
            getString(options, 'task') as TaskId,
            getString(options, 'agent') as AgentId,
          ),
        )
      })
    })

  addToken(program.command('task:prioritize'))
    .description('Cambia la prioridad de una tarea')
    .option('--task <id>', 'task ID')
    .option('--priority <n>', 'prioridad 0-100')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.prioritizeTask(
            decodeToken(context, options),
            getString(options, 'task') as TaskId,
            getNumber(options, 'priority'),
          ),
        )
      })
    })

  for (const action of ['pause', 'cancel'] as const) {
    addToken(program.command(`task:${action}`))
      .description(`${action} a task`)
      .option('--task <id>', 'task ID')
      .action(async (options: CliOptions) => {
        await withContext((context) => {
          const principal = decodeToken(context, options)
          const taskId = getString(options, 'task') as TaskId
          printJson(
            action === 'pause'
              ? context.service.pauseTask(principal, taskId)
              : context.service.cancelTask(principal, taskId),
          )
        })
      })
  }

  addProject(addToken(program.command('module:create')))
    .description('Crea un módulo propiedad de un especialista')
    .option('--name <name>', 'nombre')
    .option('--owner <id>', 'agent ID')
    .option('--paths <paths>', 'rutas separadas por coma')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.createModule(decodeToken(context, options), {
            projectId: getString(options, 'project') as ProjectId,
            name: getString(options, 'name'),
            ownerAgentId: getString(options, 'owner') as AgentId,
            pathScope: parseList(getString(options, 'paths')),
          }),
        )
      })
    })

  addToken(program.command('module:version'))
    .description('Registra una versión inmutable de un módulo')
    .option('--module <id>', 'module ID')
    .option('--commit <sha>', 'commit SHA de 40 caracteres')
    .option('--tree <hash>', 'tree hash')
    .option('--artifact <hash>', 'artifact hash')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.createModuleVersion(decodeToken(context, options), {
            moduleId: getString(options, 'module') as ModuleId,
            commitSha: getString(options, 'commit'),
            treeHash: getString(options, 'tree'),
            artifactHash: getString(options, 'artifact'),
          }),
        )
      })
    })

  addProject(addToken(program.command('module:list')))
    .description('Lista módulos')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.listModules(
            decodeToken(context, options),
            getString(options, 'project') as ProjectId,
          ),
        )
      })
    })

  addToken(program.command('contract:create'))
    .description('Crea un contrato versionado')
    .option('--task <id>', 'task ID')
    .option('--module <id>', 'module ID')
    .option('--objective <text>', 'objetivo')
    .option('--paths <paths>', 'rutas permitidas separadas por coma')
    .option('--inputs <items>', 'interfaces de entrada separadas por coma')
    .option('--outputs <items>', 'interfaces de salida separadas por coma')
    .option('--tests <items>', 'pruebas de aceptación separadas por coma')
    .option('--limits <json>', 'límites JSON')
    .option('--format <text>', 'formato de entrega')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.createContract(decodeToken(context, options), {
            taskId: getString(options, 'task') as TaskId,
            moduleId: getString(options, 'module') as ModuleId,
            objective: getString(options, 'objective'),
            allowedPaths: parseList(getString(options, 'paths')),
            inputInterfaces: parseList(getString(options, 'inputs')),
            outputInterfaces: parseList(getString(options, 'outputs')),
            acceptanceTests: parseList(getString(options, 'tests')),
            limits: readJsonArgument(getString(options, 'limits'), 'limits') as never,
            deliveryFormat: getString(options, 'format'),
          }),
        )
      })
    })

  addProject(addToken(program.command('contract:list')))
    .description('Lista contratos')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.listContracts(
            decodeToken(context, options),
            getString(options, 'project') as ProjectId,
          ),
        )
      })
    })

  addToken(program.command('review:submit'))
    .description('Registra un dictamen de jurado')
    .option('--module-version <id>', 'module version ID')
    .option('--role <role>', 'JUDGE_TESTS | JUDGE_DEBUG | JUDGE_ARCHITECTURE | JUDGE_OPTIMIZATION')
    .option('--verdict <verdict>', 'APPROVE | REJECT')
    .option('--findings <json>', 'hallazgos JSON array')
    .option('--evidence <items>', 'evidencia separada por coma')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        const role = getString(options, 'role') as never
        if (!(JUDGE_ROLES as readonly string[]).includes(role)) {
          throw new OrchestratorError('BAD_REQUEST', 'Invalid judge role')
        }
        const findings = JSON.parse(getString(options, 'findings', false) || '[]') as never
        printJson(
          context.service.submitReview(decodeToken(context, options), {
            moduleVersionId: getString(options, 'module-version') as ModuleVersionId,
            judgeRole: role,
            verdict: getString(options, 'verdict').toUpperCase() as never,
            findings,
            evidence: parseList(getOptionalString(options, 'evidence')),
          }),
        )
      })
    })

  addProject(addToken(program.command('review:list')))
    .description('Lista dictámenes')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.listReviews(
            decodeToken(context, options),
            getString(options, 'project') as ProjectId,
          ),
        )
      })
    })

  addToken(program.command('approval:record'))
    .description('Registra una aprobación humana')
    .option('--project <id>', 'project ID')
    .option('--subject-type <type>', 'PLAN | CONTRACT | MODULE | INTEGRATION | DELIVERY')
    .option('--subject-id <id>', 'subject ID')
    .option('--hash <hash>', 'subject hash')
    .option('--decision <decision>', 'APPROVED | REJECTED', 'APPROVED')
    .option('--reason <text>', 'motivo')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.recordApproval(decodeToken(context, options), {
            projectId: getString(options, 'project') as ProjectId,
            subjectType: getString(options, 'subject-type').toUpperCase() as never,
            subjectId: getString(options, 'subject-id'),
            subjectHash: getString(options, 'hash'),
            decision: getString(options, 'decision').toUpperCase() as never,
            ...(getOptionalString(options, 'reason')
              ? { reason: getOptionalString(options, 'reason') }
              : {}),
          }),
        )
      })
    })

  addProject(addToken(program.command('approval:list')))
    .description('Lista aprobaciones')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.listApprovals(
            decodeToken(context, options),
            getString(options, 'project') as ProjectId,
          ),
        )
      })
    })

  addProject(addToken(program.command('message:send')))
    .description('Envía un mensaje persistente')
    .option('--to <id>', 'recipient agent ID')
    .option('--kind <kind>', 'INFO | QUERY | ORDER | PAUSE | CANCEL', 'INFO')
    .option('--correlation <id>', 'correlation ID')
    .option('--idempotency <key>', 'idempotency key')
    .option('--payload <json>', 'payload JSON')
    .option('--text <text>', 'texto de payload')
    .option('--priority <n>', 'prioridad 0-100')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        const kind = getString(options, 'kind').toUpperCase() as MessageKind
        const payload = getOptionalString(options, 'payload')
          ? readJsonArgument(getString(options, 'payload'), 'payload')
          : { text: getString(options, 'text', false) }
        printJson(
          context.service.sendMessage(decodeToken(context, options), {
            projectId: getString(options, 'project') as ProjectId,
            toAgentId: getString(options, 'to') as AgentId,
            correlationId: getString(options, 'correlation'),
            kind,
            payload,
            idempotencyKey: getString(options, 'idempotency'),
            ...(options.priority !== undefined ? { priority: getNumber(options, 'priority') } : {}),
          }),
        )
      })
    })

  addProject(addToken(program.command('message:inbox')))
    .description('Lee el buzón propio')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.listMessages(
            decodeToken(context, options),
            getString(options, 'project') as ProjectId,
          ),
        )
      })
    })

  addToken(program.command('message:ack'))
    .description('Acusa recibo de un mensaje')
    .option('--message <id>', 'message ID')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.ackMessage(
            decodeToken(context, options),
            getString(options, 'message') as MessageId,
          ),
        )
      })
    })

  addToken(program.command('message:deliver'))
    .description('Entrega un mensaje en punto seguro')
    .option('--message <id>', 'message ID')
    .option('--safe-point', 'confirmar que es un punto seguro')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.deliverMessage(
            decodeToken(context, options),
            getString(options, 'message') as MessageId,
            options['safe-point'] === true,
          ),
        )
      })
    })

  addProject(addToken(program.command('state')))
    .description('Consulta el estado operativo compartido')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.getState(
            decodeToken(context, options),
            getString(options, 'project') as ProjectId,
          ),
        )
      })
    })

  addProject(addToken(program.command('team')))
    .description('Lista agentes persistidos')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.listAgents(
            decodeToken(context, options),
            getString(options, 'project') as ProjectId,
          ),
        )
      })
    })

  addProject(addToken(program.command('events')))
    .description('Lista eventos durables')
    .option('--limit <n>', 'máximo de eventos', '100')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.listEvents(
            decodeToken(context, options),
            getString(options, 'project') as ProjectId,
            getNumber(options, 'limit', 100),
          ),
        )
      })
    })

  addProject(addToken(program.command('audit')))
    .description('Lista decisiones de autorización')
    .option('--limit <n>', 'máximo de entradas', '100')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.listAudit(
            decodeToken(context, options),
            getString(options, 'project') as ProjectId,
            getNumber(options, 'limit', 100),
          ),
        )
      })
    })

  addProject(addToken(program.command('rejected')))
    .description('Lista operaciones rechazadas')
    .option('--limit <n>', 'máximo de entradas', '100')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.listRejected(
            decodeToken(context, options),
            getString(options, 'project') as ProjectId,
            getNumber(options, 'limit', 100),
          ),
        )
      })
    })

  addProject(addToken(program.command('outbox')))
    .description('Lista la outbox de eventos')
    .option('--status <status>', 'PENDING | DELIVERING | DELIVERED | FAILED')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.listOutbox(
            decodeToken(context, options),
            getString(options, 'project') as ProjectId,
            getOptionalString(options, 'status') as never,
          ),
        )
      })
    })

  addProject(addToken(program.command('checkpoints')))
    .description('Lista checkpoints')
    .option('--scope <scope>', 'scope')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson(
          context.service.listCheckpoints(
            decodeToken(context, options),
            getString(options, 'project') as ProjectId,
            getOptionalString(options, 'scope'),
          ),
        )
      })
    })

  addProject(addToken(program.command('temporary:grant')))
    .description('Concede un permiso temporal')
    .option('--principal <id>', 'principal ID')
    .option('--action <action>', 'acción')
    .option('--resource <resource>', 'recurso')
    .option('--effect <effect>', 'allow | deny')
    .option('--ttl <seconds>', 'vigencia', '300')
    .action(async (options: CliOptions) => {
      await withContext((context) => {
        printJson({
          id: context.service.grantTemporaryPermission(decodeToken(context, options), {
            projectId: getString(options, 'project') as ProjectId,
            principalId: getString(options, 'principal'),
            action: getString(options, 'action'),
            resource: getString(options, 'resource'),
            effect: getString(options, 'effect') as 'allow' | 'deny',
            ttlSeconds: getNumber(options, 'ttl', 300),
          }),
        })
      })
    })

  program
    .command('serve')
    .description('Inicia la API interna local')
    .option('--host <host>', 'host')
    .option('--port <port>', 'puerto')
    .action(async (options: CliOptions) => {
      const context = createAppContext()
      const handle = await startApiServer(context, {
        ...(getOptionalString(options, 'host') ? { host: getString(options, 'host') } : {}),
        ...(getOptionalString(options, 'port') ? { port: getNumber(options, 'port') } : {}),
      })
      process.stdout.write(`API: ${handle.url}\n`)
      const shutdown = async (): Promise<void> => {
        await handle.close()
        context.close()
        process.exit(0)
      }
      process.once('SIGINT', () => void shutdown())
      process.once('SIGTERM', () => void shutdown())
    })
}

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Principal } from '../auth/types.js'
import { TokenError } from '../auth/tokens.js'
import { AuthorizationError } from '../auth/authorization.js'
import { OrchestratorError } from '../orchestrator/errors.js'
import type { AgentId, MessageId, PlanId, ProjectId } from '../domain/ids.js'
import { DeliveryService } from '../integration/feedback.js'
import { RecoveryManager } from '../recovery/manager.js'
import { WorktreeManager } from '../worktrees/manager.js'
import { createOpenCodeAdapter } from '../opencode/factory.js'
import { SessionManager } from '../sessions/manager.js'
import { TaskExecutor } from '../orchestrator/task-executor.js'
import { Scheduler } from '../orchestrator/scheduler.js'
import { renderUi } from './ui.js'
import { runMathScript } from '../math/runner.js'
import type { AppContext } from '../app/context.js'

export interface ApiServerOptions {
  readonly host?: string
  readonly port?: number
}

export interface ApiServerHandle {
  readonly url: string
  close(): Promise<void>
}

const MAX_BODY_BYTES = 1_048_576

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(payload)
}

function sendError(response: ServerResponse, status: number, code: string, message: string): void {
  sendJson(response, status, { error: { code, message } })
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('JSON body must be an object'))
          return
        }
        resolve(parsed as Record<string, unknown>)
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    request.on('error', reject)
  })
}

function bearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return undefined
  return header.slice('Bearer '.length).trim()
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} is required`)
  return value
}

function stringList(body: Record<string, unknown>, key: string): string[] {
  const value = body[key]
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

/**
 * API interna local. No registra cuerpos ni tokens. El CLI y la futura UI
 * consumen los mismos servicios que los tests.
 */
export async function startApiServer(
  context: AppContext,
  options: ApiServerOptions = {},
): Promise<ApiServerHandle> {
  const host = options.host ?? context.config.ORCH_API_HOST
  const port = options.port ?? context.config.ORCH_API_PORT
  const localHumanToken = context.tokens.issue(
    { subjectId: 'local-ui', kind: 'HUMAN', role: 'HUMAN' },
    60 * 60 * 24 * 30,
  )

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    const path = url.pathname
    try {
      if (request.method === 'GET' && path === '/api/health') {
        sendJson(response, 200, {
          status: 'ok',
          schemaVersion: context.store.schemaVersion,
          time: new Date().toISOString(),
        })
        return
      }
      if (request.method === 'GET' && (path === '/ui' || path === '/ui/')) {
        const html = renderUi()
        response.statusCode = 200
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.setHeader('cache-control', 'no-store')
        response.end(html)
        return
      }
      if (request.method === 'GET' && path === '/api/session') {
        const remote = request.socket.remoteAddress ?? ''
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
          sendError(response, 403, 'FORBIDDEN', 'Local UI session only')
          return
        }
        sendJson(response, 200, { token: localHumanToken, subjectId: 'local-ui' })
        return
      }
      if (path.startsWith('/api/tools/')) {
        const secret = context.config.ORCH_TOOL_SECRET
        if (!secret || request.headers['x-orch-tool-secret'] !== secret) {
          sendError(response, 401, 'UNAUTHORIZED', 'Tool secret required')
          return
        }
        const toolProjectId = (url.searchParams.get('projectId') ?? undefined) as
          ProjectId | undefined
        if (request.method === 'POST' && path === '/api/tools/state') {
          const body = await readJson(request)
          const id = (String(body.projectId ?? toolProjectId ?? '') || undefined) as
            ProjectId | undefined
          if (!id) throw new Error('projectId is required')
          sendJson(
            response,
            200,
            context.service.getState({ subjectId: 'tool', kind: 'HUMAN', role: 'HUMAN' }, id),
          )
          return
        }
        if (request.method === 'POST' && path === '/api/tools/inbox') {
          const body = await readJson(request)
          const agent = context.store.getAgent(requireString(body, 'agentId') as never)
          if (!agent) throw new Error('agent not found')
          sendJson(response, 200, context.store.listMessages(agent.projectId, agent.id))
          return
        }
        if (request.method === 'POST' && path === '/api/tools/send') {
          const body = await readJson(request)
          const from = context.store.getAgent(requireString(body, 'fromAgentId') as never)
          const to = context.store.getAgent(requireString(body, 'toAgentId') as never)
          if (!from || !to) throw new Error('agent not found')
          const result = context.service.sendMessage(
            {
              subjectId: from.id,
              kind: 'AGENT',
              role: from.role,
              projectId: from.projectId,
              agentId: from.id,
            },
            {
              projectId: from.projectId,
              toAgentId: to.id,
              correlationId: String(body.correlationId ?? 'tool'),
              kind: String(body.kind ?? 'INFO') as never,
              priority: typeof body.priority === 'number' ? body.priority : undefined,
              payload:
                body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
                  ? (body.payload as Record<string, unknown>)
                  : {},
              idempotencyKey: requireString(body, 'idempotencyKey'),
            },
          )
          sendJson(response, 200, result)
          return
        }
        if (request.method === 'POST' && path === '/api/tools/delivery') {
          const body = await readJson(request)
          const id = (String(body.projectId ?? toolProjectId ?? '') || undefined) as
            ProjectId | undefined
          if (!id) throw new Error('projectId is required')
          sendJson(response, 200, context.store.listFinalDeliveries(id)[0] ?? null)
          return
        }
        if (request.method === 'POST' && path === '/api/tools/math/run') {
          const body = await readJson(request)
          const result = runMathScript({
            script: requireString(body, 'script'),
            repositoryRoot: context.config.projectDir,
            interpreter: String(body.interpreter ?? 'auto') as 'auto' | 'python' | 'node',
            ...(typeof body.timeoutMs === 'number' ? { timeoutMs: body.timeoutMs } : {}),
          })
          sendJson(response, 200, result)
          return
        }
        sendError(response, 404, 'NOT_FOUND', 'Tool route not found')
        return
      }

      const token = bearerToken(request)
      if (!token) {
        sendError(response, 401, 'UNAUTHORIZED', 'Bearer token required')
        return
      }
      let principal: Principal
      try {
        principal = context.tokens.verify(token)
      } catch (error) {
        const message = error instanceof TokenError ? error.message : 'Invalid token'
        sendError(response, 401, 'UNAUTHORIZED', message)
        return
      }

      const method = request.method ?? 'GET'
      const projectId = (url.searchParams.get('projectId') ?? undefined) as ProjectId | undefined

      if (method === 'GET' && path === '/api/projects') {
        sendJson(response, 200, context.service.listProjects(principal))
        return
      }
      if (method === 'POST' && path === '/api/projects') {
        const body = await readJson(request)
        const project = context.service.createProject(principal, {
          name: requireString(body, 'name'),
          repoPath: context.config.projectDir,
        })
        const agents = context.service.bootstrapAgents(principal, project.id)
        sendJson(response, 201, { project, agents })
        return
      }
      const planMatch = /^\/api\/projects\/([^/]+)\/plan$/.exec(path)
      if (method === 'POST' && planMatch) {
        const id = planMatch[1] as ProjectId
        const body = await readJson(request)
        const parent = context.store
          .listAgents(id)
          .find((agent) => agent.opencodeAgentId === 'padre')
        if (!parent) throw new OrchestratorError('NOT_FOUND', 'Parent agent not found', 404)
        const objective = requireString(body, 'objective')
        const plan = context.service.createPlan(
          {
            subjectId: parent.id,
            kind: 'AGENT',
            role: parent.role,
            projectId: id,
            agentId: parent.id,
          },
          {
            projectId: id,
            title: requireString(body, 'title'),
            spec: { objective, source: 'local-ui' },
            plan: { objective, source: 'local-ui' },
          },
        )
        sendJson(response, 201, plan)
        return
      }
      const taskMatch = /^\/api\/projects\/([^/]+)\/tasks$/.exec(path)
      if (method === 'POST' && taskMatch) {
        const id = taskMatch[1] as ProjectId
        const body = await readJson(request)
        const title = requireString(body, 'title')
        const description = String(body.description ?? title)
        const ownerAgentId = requireString(body, 'ownerAgentId') as AgentId
        const paths = stringList(body, 'paths')
        const tests = stringList(body, 'tests')
        if (paths.length === 0) throw new Error('paths is required')
        if (tests.length === 0) throw new Error('tests is required')
        const plan = context.store
          .listPlans(id)
          .find((candidate) => candidate.status === 'APPROVED')
        if (!plan) throw new OrchestratorError('CONFLICT', 'No approved plan', 409)
        const coordinator = context.store
          .listAgents(id)
          .find((agent) => agent.opencodeAgentId === 'coordinador')
        if (!coordinator)
          throw new OrchestratorError('NOT_FOUND', 'Coordinator agent not found', 404)
        const coordinatorPrincipal: Principal = {
          subjectId: coordinator.id,
          kind: 'AGENT',
          role: coordinator.role,
          projectId: id,
          agentId: coordinator.id,
        }
        const module = context.service.createModule(coordinatorPrincipal, {
          projectId: id,
          name: title,
          ownerAgentId,
          pathScope: paths,
        })
        const task = context.service.createTask(coordinatorPrincipal, {
          projectId: id,
          planId: plan.id,
          title,
          description,
          moduleId: module.id,
          ownerAgentId,
        })
        const contract = context.service.createContract(coordinatorPrincipal, {
          taskId: task.id,
          moduleId: module.id,
          objective: description,
          allowedPaths: paths,
          inputInterfaces: ['none'],
          outputInterfaces: ['none'],
          acceptanceTests: tests,
          limits: { maxDurationMinutes: 30 },
          deliveryFormat: 'DeliveryDraft',
        })
        const assigned = context.service.assignTask(coordinatorPrincipal, task.id, ownerAgentId)
        sendJson(response, 201, { module, task: assigned, contract })
        return
      }
      const projectAction = /^\/api\/projects\/([^/]+)\/(start|pause|resume)$/.exec(path)
      if (method === 'POST' && projectAction) {
        const id = projectAction[1] as ProjectId
        const action = projectAction[2]
        const project =
          action === 'start'
            ? context.service.startProject(principal, id)
            : action === 'pause'
              ? context.service.pauseProject(principal, id)
              : context.service.resumeProject(principal, id)
        sendJson(response, 200, project)
        return
      }
      const schedulerMatch = /^\/api\/projects\/([^/]+)\/scheduler\/run$/.exec(path)
      if (method === 'POST' && schedulerMatch) {
        const id = schedulerMatch[1] as ProjectId
        const maxParallel = Math.min(
          context.config.ORCH_MAX_PARALLEL,
          context.config.ORCH_MAX_AGENTS,
        )
        const adapter = await createOpenCodeAdapter(context.config)
        try {
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
          const results = await scheduler.runOnce(principal, id)
          sendJson(response, 200, { results })
        } finally {
          await adapter.close()
        }
        return
      }

      if (method === 'GET' && path === '/api/state') {
        sendJson(response, 200, context.service.getState(principal, requireProject(projectId)))
        return
      }
      if (method === 'GET' && path === '/api/usage') {
        const id = requireProject(projectId)
        context.authz.require(principal, 'resource.read', { type: 'project', id })
        const labelFor = (by: 'agent' | 'task' | 'purpose', key: string): string => {
          if (by === 'agent') {
            const agent = context.store.getAgent(key as never)
            return agent ? `${agent.opencodeAgentId} (${agent.name})` : key
          }
          if (by === 'task') {
            const task = context.store.getTask(key as never)
            return task ? `${task.title} [${task.state}]` : key
          }
          return key
        }
        const groups = (['agent', 'task', 'purpose'] as const).map((by) => ({
          by,
          rows: context.store.usageBreakdown(id, by).map((row) => ({
            ...row,
            label: labelFor(by, row.key),
          })),
        }))
        sendJson(response, 200, { groups })
        return
      }
      if (method === 'GET' && path === '/api/plans') {
        const id = requireProject(projectId)
        sendJson(response, 200, context.service.listPlans(principal, id))
        return
      }
      if (method === 'GET' && path === '/api/agents') {
        sendJson(response, 200, context.service.listAgents(principal, requireProject(projectId)))
        return
      }
      if (method === 'GET' && path === '/api/tasks') {
        sendJson(response, 200, context.service.listTasks(principal, requireProject(projectId)))
        return
      }
      if (method === 'GET' && path === '/api/contracts') {
        sendJson(response, 200, context.service.listContracts(principal, requireProject(projectId)))
        return
      }
      if (method === 'GET' && path === '/api/modules') {
        sendJson(response, 200, context.service.listModules(principal, requireProject(projectId)))
        return
      }
      if (method === 'GET' && path === '/api/reviews') {
        sendJson(response, 200, context.service.listReviews(principal, requireProject(projectId)))
        return
      }
      if (method === 'GET' && path === '/api/events') {
        const limit = Number(url.searchParams.get('limit') ?? 100)
        sendJson(
          response,
          200,
          context.service.listEvents(principal, requireProject(projectId), limit),
        )
        return
      }
      if (method === 'GET' && path === '/api/messages') {
        sendJson(response, 200, context.service.listMessages(principal, requireProject(projectId)))
        return
      }
      if (method === 'GET' && path === '/api/sessions') {
        const id = requireProject(projectId)
        context.authz.require(principal, 'state.read', { type: 'project', id })
        const sessions = context.store.listSessions(id).map((session) => {
          const agent = context.store.getAgent(session.agentId)
          const task = session.taskId ? context.store.getTask(session.taskId) : undefined
          return {
            ...session,
            agent: agent
              ? {
                  id: agent.id,
                  name: agent.name,
                  role: agent.role,
                  opencodeAgentId: agent.opencodeAgentId,
                }
              : null,
            task: task ? { id: task.id, title: task.title, state: task.state } : null,
            usage: context.store.usageForSession(session.id),
          }
        })
        sessions.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        sendJson(response, 200, sessions)
        return
      }
      const transcriptMatch = /^\/api\/sessions\/([^/]+)\/transcript$/.exec(path)
      if (method === 'GET' && transcriptMatch) {
        const session = context.store.getSession(transcriptMatch[1]!)
        if (!session) throw new OrchestratorError('NOT_FOUND', 'Session not found', 404)
        context.authz.require(principal, 'state.read', {
          type: 'project',
          id: session.projectId,
        })
        if (!session.opencodeSessionId) {
          sendJson(response, 200, { messages: [] })
          return
        }
        const adapter = await createOpenCodeAdapter(context.config)
        try {
          const messages = await adapter.getTranscript(session.opencodeSessionId)
          sendJson(response, 200, { messages })
        } finally {
          await adapter.close()
        }
        return
      }
      if (method === 'GET' && path === '/api/worktrees') {
        const id = requireProject(projectId)
        context.authz.require(principal, 'state.read', { type: 'project', id })
        sendJson(response, 200, context.store.listWorktrees(id))
        return
      }
      if (method === 'GET' && path === '/api/attempts') {
        const id = requireProject(projectId)
        context.authz.require(principal, 'state.read', { type: 'project', id })
        sendJson(
          response,
          200,
          context.store.listTasks(id).flatMap((task) => context.store.listTaskAttempts(task.id)),
        )
        return
      }
      if (method === 'GET' && path === '/api/jury/runs') {
        const id = requireProject(projectId)
        context.authz.require(principal, 'jury.read', { type: 'project', id })
        sendJson(response, 200, context.store.listJuryRuns(id))
        return
      }
      if (method === 'GET' && path === '/api/jury/consolidations') {
        const id = requireProject(projectId)
        context.authz.require(principal, 'jury.read', { type: 'project', id })
        sendJson(response, 200, context.store.listConsolidations(id))
        return
      }
      if (method === 'GET' && path === '/api/jury/approved') {
        const id = requireProject(projectId)
        context.authz.require(principal, 'jury.read', { type: 'project', id })
        sendJson(response, 200, context.store.listApprovedModules(id))
        return
      }
      if (method === 'GET' && path === '/api/integrations') {
        const id = requireProject(projectId)
        context.authz.require(principal, 'integration.read', { type: 'project', id })
        sendJson(response, 200, context.store.listIntegrationRuns(id))
        return
      }
      if (method === 'GET' && path === '/api/integrations/manifests') {
        const id = requireProject(projectId)
        context.authz.require(principal, 'integration.read', { type: 'project', id })
        sendJson(response, 200, context.store.listIntegrationManifests(id))
        return
      }
      if (method === 'GET' && path === '/api/feedback') {
        const id = requireProject(projectId)
        context.authz.require(principal, 'feedback.read', { type: 'project', id })
        sendJson(response, 200, context.store.listFeedbackRuns(id))
        return
      }
      if (method === 'GET' && path === '/api/deliveries') {
        const id = requireProject(projectId)
        context.authz.require(principal, 'delivery.read', { type: 'project', id })
        sendJson(response, 200, context.store.listFinalDeliveries(id))
        return
      }
      if (method === 'GET' && path === '/api/recovery/history') {
        const id = requireProject(projectId)
        context.authz.require(principal, 'recovery.read', { type: 'project', id })
        sendJson(
          response,
          200,
          context.store.listRecoveryRuns(id).map((run) => ({
            ...run,
            actions: context.store.listRecoveryActions(run.id),
          })),
        )
        return
      }
      if (method === 'POST' && path === '/api/recovery/run') {
        const id = requireProject(projectId)
        const body = await readJson(request)
        const manager = new RecoveryManager(
          context.store,
          context.authz,
          new WorktreeManager(context.config.projectDir, context.config.worktreeRoot),
          {
            staleMinutes: context.config.ORCH_RECOVERY_STALE_MINUTES,
            taskMaxAttempts: context.config.ORCH_TASK_MAX_ATTEMPTS,
            leaseSeconds: context.config.ORCH_LEASE_SECONDS,
            operationLeaseSeconds: context.config.ORCH_OPERATION_LEASE_SECONDS,
          },
          undefined,
          context.resources,
        )
        sendJson(response, 200, await manager.run(principal, id, { apply: body.apply === true }))
        return
      }
      if (method === 'GET' && path === '/api/audit') {
        sendJson(response, 200, context.service.listAudit(principal, requireProject(projectId)))
        return
      }
      if (method === 'GET' && path === '/api/rejected') {
        sendJson(response, 200, context.service.listRejected(principal, requireProject(projectId)))
        return
      }
      if (method === 'GET' && path === '/api/outbox') {
        sendJson(response, 200, context.service.listOutbox(principal, requireProject(projectId)))
        return
      }

      if (method === 'POST' && path === '/api/messages') {
        const body = await readJson(request)
        const result = context.service.sendMessage(principal, {
          projectId: requireString(body, 'projectId') as ProjectId,
          toAgentId: requireString(body, 'toAgentId') as never,
          correlationId: requireString(body, 'correlationId'),
          kind: requireString(body, 'kind') as never,
          idempotencyKey: requireString(body, 'idempotencyKey'),
          payload:
            body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
              ? (body.payload as Record<string, unknown>)
              : {},
          ...(typeof body.priority === 'number' ? { priority: body.priority } : {}),
        })
        sendJson(response, 200, result)
        return
      }

      const ackMatch = /^\/api\/messages\/([^/]+)\/ack$/.exec(path)
      if (method === 'POST' && ackMatch?.[1]) {
        sendJson(response, 200, context.service.ackMessage(principal, ackMatch[1] as MessageId))
        return
      }

      const deliverMatch = /^\/api\/messages\/([^/]+)\/deliver$/.exec(path)
      if (method === 'POST' && deliverMatch?.[1]) {
        const body = await readJson(request)
        sendJson(
          response,
          200,
          context.service.deliverMessage(
            principal,
            deliverMatch[1] as MessageId,
            body.safePoint === true,
          ),
        )
        return
      }

      const approveMatch = /^\/api\/plans\/([^/]+)\/approve$/.exec(path)
      if (method === 'POST' && approveMatch?.[1]) {
        const body = await readJson(request)
        sendJson(
          response,
          200,
          context.service.approvePlan(
            principal,
            approveMatch[1] as PlanId,
            requireString(body, 'hash'),
          ),
        )
        return
      }

      const startMatch = /^\/api\/projects\/([^/]+)\/start$/.exec(path)
      if (method === 'POST' && startMatch?.[1]) {
        sendJson(response, 200, context.service.startProject(principal, startMatch[1] as ProjectId))
        return
      }

      const finalizeDeliveryMatch = /^\/api\/deliveries\/([^/]+)\/finalize$/.exec(path)
      if (method === 'POST' && finalizeDeliveryMatch?.[1]) {
        const service = new DeliveryService(context.store, context.authz)
        sendJson(response, 200, service.finalize(principal, finalizeDeliveryMatch[1]))
        return
      }

      sendError(response, 404, 'NOT_FOUND', 'Route not found')
    } catch (error) {
      if (error instanceof AuthorizationError) {
        sendError(response, 403, error.code, error.message)
        return
      }
      if (error instanceof OrchestratorError) {
        sendError(response, error.status, error.code, error.message)
        return
      }
      const message = error instanceof Error ? error.message : 'Internal error'
      if (
        message.includes('required') ||
        message.includes('Invalid JSON') ||
        message.includes('too large')
      ) {
        sendError(response, 400, 'BAD_REQUEST', message)
        return
      }
      sendError(response, 500, 'INTERNAL_ERROR', 'Internal error')
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address() as AddressInfo
  return {
    url: `http://${host}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

function requireProject(projectId: ProjectId | undefined): ProjectId {
  if (!projectId)
    throw new OrchestratorError('BAD_REQUEST', 'projectId query parameter is required')
  return projectId
}

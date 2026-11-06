import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Principal } from '../auth/types.js'
import { TokenError } from '../auth/tokens.js'
import { AuthorizationError } from '../auth/authorization.js'
import { OrchestratorError } from '../orchestrator/errors.js'
import type { MessageId, PlanId, ProjectId } from '../domain/ids.js'
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

      if (method === 'GET' && path === '/api/state') {
        sendJson(response, 200, context.service.getState(principal, requireProject(projectId)))
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
        sendJson(response, 200, context.store.listSessions(id))
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

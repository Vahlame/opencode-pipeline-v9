import { afterEach, describe, expect, it } from 'vitest'
import { createAppContext } from '../../src/app/context.js'
import type { AppContext } from '../../src/app/context.js'
import { startApiServer } from '../../src/api/server.js'
import type { ApiServerHandle } from '../../src/api/server.js'
import { loadConfig } from '../../src/config/env.js'
import { TEST_SECRET } from '../helpers/phase2.js'

async function request(
  url: string,
  token?: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown; text: string }> {
  const headers = new Headers(init.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (init.body) headers.set('content-type', 'application/json')
  const response = await fetch(url, { ...init, headers })
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body, text }
}

describe('internal API', () => {
  let context: AppContext | undefined
  let server: ApiServerHandle | undefined

  afterEach(async () => {
    if (server) await server.close()
    context?.close()
    server = undefined
    context = undefined
  })

  it('authenticates, shares state, sends messages and audits denial', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      OPENCODE_PROJECT_DIR: process.cwd(),
      ORCH_DB_PATH: ':memory:',
      ORCH_AUTH_SECRET: TEST_SECRET,
      ORCH_API_HOST: '127.0.0.1',
      ORCH_API_PORT: '0',
    })
    context = createAppContext(config)
    const humanToken = context.tokens.issue({ subjectId: 'human', kind: 'HUMAN', role: 'HUMAN' })
    const human = context.tokens.verify(humanToken)
    const project = context.service.createProject(human, {
      name: 'API project',
      repoPath: 'C:/api-project',
    })
    const agents = context.service.bootstrapAgents(human, project.id)
    const byCode = new Map(agents.map((agent) => [agent.opencodeAgentId, agent]))
    const parent = byCode.get('padre')!
    const coordinator = byCode.get('coordinador')!
    const frontend = byCode.get('frontend')!
    const parentToken = context.tokens.issue({
      subjectId: parent.id,
      kind: 'AGENT',
      role: parent.role,
      projectId: project.id,
      agentId: parent.id,
    })
    const coordinatorToken = context.tokens.issue({
      subjectId: coordinator.id,
      kind: 'AGENT',
      role: coordinator.role,
      projectId: project.id,
      agentId: coordinator.id,
    })
    const frontendToken = context.tokens.issue({
      subjectId: frontend.id,
      kind: 'AGENT',
      role: frontend.role,
      projectId: project.id,
      agentId: frontend.id,
    })
    const plan = context.service.createPlan(context.tokens.verify(parentToken), {
      projectId: project.id,
      title: 'API plan',
      spec: { objective: 'api' },
      plan: { steps: [] },
    })
    context.service.approvePlan(human, plan.id, plan.hash)
    context.service.startProject(human, project.id)

    server = await startApiServer(context, { host: '127.0.0.1', port: 0 })
    const base = server.url

    const health = await request(`${base}/api/health`)
    expect(health.status).toBe(200)

    const session = await request(`${base}/api/session`)
    expect(session.status).toBe(200)
    expect(typeof (session.body as { token: unknown }).token).toBe('string')

    const projects = await request(`${base}/api/projects`, humanToken)
    expect(projects.status).toBe(200)
    expect((projects.body as unknown[]).length).toBeGreaterThan(0)

    const created = await request(`${base}/api/projects`, humanToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'API second project' }),
    })
    expect(created.status).toBe(201)
    expect((created.body as { agents: unknown[] }).agents.length).toBeGreaterThan(0)

    const unauthenticated = await request(`${base}/api/state?projectId=${project.id}`)
    expect(unauthenticated.status).toBe(401)

    const state = await request(`${base}/api/state?projectId=${project.id}`, humanToken)
    expect(state.status).toBe(200)
    expect((state.body as { agents: unknown[] }).agents).toHaveLength(13)

    const usage = await request(`${base}/api/usage?projectId=${project.id}`, humanToken)
    expect(usage.status).toBe(200)
    expect((usage.body as { groups: unknown[] }).groups).toHaveLength(3)

    const sessions = await request(`${base}/api/sessions?projectId=${project.id}`, humanToken)
    expect(sessions.status).toBe(200)
    expect(Array.isArray(sessions.body)).toBe(true)

    const integrations = await request(
      `${base}/api/integrations?projectId=${project.id}`,
      humanToken,
    )
    expect(integrations.status).toBe(200)
    expect(integrations.body).toEqual([])
    const manifests = await request(
      `${base}/api/integrations/manifests?projectId=${project.id}`,
      humanToken,
    )
    expect(manifests.status).toBe(200)
    expect(manifests.body).toEqual([])
    const feedback = await request(`${base}/api/feedback?projectId=${project.id}`, humanToken)
    expect(feedback.status).toBe(200)
    expect(feedback.body).toEqual([])
    const deliveries = await request(`${base}/api/deliveries?projectId=${project.id}`, humanToken)
    expect(deliveries.status).toBe(200)
    expect(deliveries.body).toEqual([])

    const sent = await request(`${base}/api/messages`, coordinatorToken, {
      method: 'POST',
      body: JSON.stringify({
        projectId: project.id,
        toAgentId: frontend.id,
        correlationId: 'api-corr',
        kind: 'INFO',
        payload: { text: 'hola api' },
        idempotencyKey: 'api-idem',
      }),
    })
    expect(sent.status).toBe(200)
    const message = (sent.body as { message: { id: string; state: string } }).message
    expect(message.state).toBe('QUEUED')

    const duplicate = await request(`${base}/api/messages`, coordinatorToken, {
      method: 'POST',
      body: JSON.stringify({
        projectId: project.id,
        toAgentId: frontend.id,
        correlationId: 'api-corr',
        kind: 'INFO',
        payload: { text: 'hola api' },
        idempotencyKey: 'api-idem',
      }),
    })
    expect(duplicate.status).toBe(200)
    expect((duplicate.body as { duplicate: boolean }).duplicate).toBe(true)

    const inbox = await request(`${base}/api/messages?projectId=${project.id}`, frontendToken)
    expect(inbox.status).toBe(200)
    expect((inbox.body as Array<{ id: string }>).some((item) => item.id === message.id)).toBe(true)

    const ack = await request(`${base}/api/messages/${message.id}/ack`, frontendToken, {
      method: 'POST',
      body: '{}',
    })
    expect(ack.status).toBe(200)
    expect((ack.body as { state: string }).state).toBe('ACKED')

    const deniedOrder = await request(`${base}/api/messages`, frontendToken, {
      method: 'POST',
      body: JSON.stringify({
        projectId: project.id,
        toAgentId: coordinator.id,
        correlationId: 'api-order-denied',
        kind: 'ORDER',
        payload: { text: 'no autorizado' },
        idempotencyKey: 'api-order-denied',
      }),
    })
    expect(deniedOrder.status).toBe(403)

    const rejected = await request(`${base}/api/rejected?projectId=${project.id}`, humanToken)
    expect(rejected.status).toBe(200)
    expect(Array.isArray(rejected.body)).toBe(true)
    expect(JSON.stringify(rejected.body)).toContain('message.send')

    expect(state.text).not.toContain(parentToken)
    expect(sent.text).not.toContain(coordinatorToken)
    expect(JSON.stringify(rejected.body)).not.toContain(TEST_SECRET)
    expect(JSON.stringify(rejected.body)).not.toContain(humanToken)
  })
})

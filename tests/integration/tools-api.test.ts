import { afterEach, describe, expect, it } from 'vitest'
import { createAppContext } from '../../src/app/context.js'
import type { AppContext } from '../../src/app/context.js'
import { startApiServer } from '../../src/api/server.js'
import type { ApiServerHandle } from '../../src/api/server.js'
import { loadConfig } from '../../src/config/env.js'
import { TEST_SECRET } from '../helpers/phase2.js'

const TOOL_SECRET = 'tool-secret-for-tests-at-least-32-chars'

describe('orchestrator tools API', () => {
  let context: AppContext | undefined
  let server: ApiServerHandle | undefined

  afterEach(async () => {
    if (server) await server.close()
    context?.close()
    server = undefined
    context = undefined
  })

  it('requires the tool secret and returns shared state', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      OPENCODE_PROJECT_DIR: process.cwd(),
      ORCH_DB_PATH: ':memory:',
      ORCH_AUTH_SECRET: TEST_SECRET,
      ORCH_TOOL_SECRET: TOOL_SECRET,
      ORCH_API_HOST: '127.0.0.1',
      ORCH_API_PORT: '0',
    })
    context = createAppContext(config)
    const humanToken = context.tokens.issue({ subjectId: 'human', kind: 'HUMAN', role: 'HUMAN' })
    const human = context.tokens.verify(humanToken)
    const project = context.service.createProject(human, {
      name: 'Tools API',
      repoPath: 'C:/tools-api',
    })
    context.service.bootstrapAgents(human, project.id)
    server = await startApiServer(context, { host: '127.0.0.1', port: 0 })
    const unauthorized = await fetch(`${server.url}/api/tools/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id }),
    })
    expect(unauthorized.status).toBe(401)
    const response = await fetch(`${server.url}/api/tools/state`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orch-tool-secret': TOOL_SECRET,
      },
      body: JSON.stringify({ projectId: project.id }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { project: { id: string }; agents: unknown[] }
    expect(body.project.id).toBe(project.id)
    expect(body.agents).toHaveLength(13)
    const ui = await fetch(`${server.url}/ui`)
    expect(ui.status).toBe(200)
    expect(await ui.text()).toContain('Control room')
  })
})

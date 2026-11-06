import { describe, expect, it } from 'vitest'
import { SdkOpenCodeAdapter } from '../../src/opencode/index.js'

const enabled = process.env.OPENCODE_SDK_TESTS === '1'

describe.skipIf(!enabled)('OpenCode V2 SDK host (opt-in)', () => {
  it('starts an isolated embedded host and manages a session', async () => {
    const adapter = await SdkOpenCodeAdapter.create()
    try {
      const health = await adapter.health()
      expect(health.ok).toBe(true)
      expect(health.version).toBeDefined()

      const agents = await adapter.listAgents({ directory: process.cwd() })
      expect(agents.some((agent) => agent.id === 'padre')).toBe(true)

      const session = await adapter.createSession({
        directory: process.cwd(),
        agent: 'padre',
        title: 'SDK host test',
      })
      expect(session.id.length).toBeGreaterThan(0)
      expect(await adapter.getSession(session.id)).not.toBeNull()

      await adapter.deleteSession(session.id)
      expect(await adapter.getSession(session.id)).toBeNull()
    } finally {
      await adapter.close()
    }
  }, 180_000)
})

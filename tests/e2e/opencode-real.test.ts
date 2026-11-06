import { describe, expect, it } from 'vitest'
import { loadConfig, parseModelRef } from '../../src/config/env.js'
import { HttpOpenCodeAdapter } from '../../src/opencode/index.js'
import { exerciseAdapterContract } from '../contract/adapter-contract.js'

const enabled = process.env.OPENCODE_REAL_TESTS === '1'

describe.skipIf(!enabled)('OpenCode V2 real (opt-in)', () => {
  it('creates a real session, executes a prompt and reads the assistant response', async () => {
    const config = loadConfig()
    const adapter = await HttpOpenCodeAdapter.create({
      ...(config.OPENCODE_BASE_URL ? { baseUrl: config.OPENCODE_BASE_URL } : {}),
      ...(config.OPENCODE_PASSWORD ? { password: config.OPENCODE_PASSWORD } : {}),
    })

    try {
      const health = await adapter.health()
      expect(health.ok).toBe(true)
      expect(health.version).toBeDefined()

      await exerciseAdapterContract(adapter, {
        directory: config.projectDir,
        agent: config.OPENCODE_AGENT,
        ...(parseModelRef(config.OPENCODE_MODEL)
          ? { model: parseModelRef(config.OPENCODE_MODEL)! }
          : {}),
        keepSession: config.OPENCODE_KEEP_SESSION,
      })
    } finally {
      await adapter.close()
    }
  }, 180_000)
})

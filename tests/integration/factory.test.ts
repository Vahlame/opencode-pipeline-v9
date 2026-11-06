import { describe, expect, it } from 'vitest'
import { createOpenCodeAdapter } from '../../src/opencode/index.js'
import { loadConfig } from '../../src/config/env.js'

describe('adapter factory', () => {
  it('creates a mock adapter without touching OpenCode', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      OPENCODE_RUNTIME: 'mock',
      OPENCODE_PROJECT_DIR: process.cwd(),
    })
    const adapter = await createOpenCodeAdapter(config)
    expect(adapter.runtime).toBe('mock')
    expect((await adapter.health()).ok).toBe(true)
    await adapter.close()
  })
})

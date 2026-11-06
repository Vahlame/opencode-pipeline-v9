import { describe, expect, it } from 'vitest'
import { MockOpenCodeAdapter } from '../../src/opencode/index.js'
import { exerciseAdapterContract } from '../contract/adapter-contract.js'

describe('MockOpenCodeAdapter', () => {
  it('satisfies the adapter contract', async () => {
    const adapter = new MockOpenCodeAdapter()
    await exerciseAdapterContract(adapter, { directory: process.cwd() })
    await adapter.close()
  })

  it('creates, lists, prompts and deletes a session deterministically', async () => {
    const adapter = new MockOpenCodeAdapter({ responseFactory: () => 'OK' })
    const session = await adapter.createSession({
      directory: process.cwd(),
      agent: 'frontend',
      title: 'Test session',
    })

    expect(session.id).toBe('mock-session-1')
    expect(await adapter.listSessions({ directory: process.cwd() })).toHaveLength(1)

    await adapter.prompt({ sessionID: session.id, text: 'Hello' })
    await adapter.waitForIdle(session.id)
    const transcript = await adapter.getTranscript(session.id)

    expect(transcript.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(transcript[1]?.text).toBe('OK')

    await adapter.deleteSession(session.id)
    expect(await adapter.getSession(session.id)).toBeNull()
  })

  it('rejects an unknown agent', async () => {
    const adapter = new MockOpenCodeAdapter()
    await expect(
      adapter.createSession({
        directory: process.cwd(),
        agent: 'does-not-exist',
      }),
    ).rejects.toThrow(/no existe/)
  })

  it('can simulate a prompt failure', async () => {
    const adapter = new MockOpenCodeAdapter()
    const session = await adapter.createSession({
      directory: process.cwd(),
      agent: 'padre',
    })
    adapter.failNextPrompt(new Error('simulated failure'))

    await expect(adapter.prompt({ sessionID: session.id, text: 'falla' })).rejects.toThrow(
      'simulated failure',
    )
  })
})

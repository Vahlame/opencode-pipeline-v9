import { expect } from 'vitest'
import type { ModelReference, OpenCodeAdapter } from '../../src/opencode/index.js'

export interface AdapterContractOptions {
  readonly directory: string
  readonly agent?: string
  readonly model?: ModelReference
  readonly keepSession?: boolean
}

/**
 * Contrato mínimo compartido por todos los runtimes. Cualquier adaptador debe
 * poder superar esta secuencia sin conocer si es HTTP, SDK o mock.
 */
export async function exerciseAdapterContract(
  adapter: OpenCodeAdapter,
  options: AdapterContractOptions,
): Promise<void> {
  const health = await adapter.health()
  expect(health.ok).toBe(true)
  expect(health.runtime).toBe(adapter.runtime)

  const agentId = options.agent ?? 'padre'
  const agents = await adapter.listAgents({ directory: options.directory })
  expect(agents.some((agent) => agent.id === agentId)).toBe(true)

  const session = await adapter.createSession({
    directory: options.directory,
    agent: agentId,
    title: 'Adapter contract test',
    ...(options.model ? { model: options.model } : {}),
    metadata: { source: 'adapter-contract-test' },
  })
  expect(session.id.length).toBeGreaterThan(0)
  expect(session.directory).toBe(options.directory)

  try {
    const receipt = await adapter.prompt({
      sessionID: session.id,
      text: 'Responde únicamente con la palabra OK.',
      delivery: 'queue',
    })
    expect(receipt.sessionID).toBe(session.id)

    await adapter.waitForIdle(session.id, 120_000)
    const transcript = await adapter.getTranscript(session.id)
    expect(transcript.some((message) => message.role === 'user')).toBe(true)
    const assistant = transcript.find((message) => message.role === 'assistant')
    expect(assistant?.text.trim().length ?? 0).toBeGreaterThan(0)

    if (!options.keepSession) {
      await adapter.deleteSession(session.id)
      expect(await adapter.getSession(session.id)).toBeNull()
    }
  } finally {
    if (!options.keepSession) {
      await adapter.deleteSession(session.id).catch(() => undefined)
    }
  }
}

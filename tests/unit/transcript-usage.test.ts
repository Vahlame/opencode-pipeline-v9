import { describe, expect, it } from 'vitest'
import { toTranscriptMessage } from '../../src/opencode/transcript.js'

describe('OpenCode transcript usage', () => {
  it('keeps exact tokens and cost from assistant messages', () => {
    const message = toTranscriptMessage({
      id: 'msg_1',
      type: 'assistant',
      agent: 'frontend',
      model: { providerID: 'test', id: 'test' },
      time: { created: 1 },
      content: [{ type: 'text', text: 'done' }],
      tokens: { input: 10, output: 20, reasoning: 3, cache: { read: 4, write: 5 } },
      cost: 0.25,
    })
    expect(message).toMatchObject({
      id: 'msg_1',
      role: 'assistant',
      text: 'done',
      tokens: { input: 10, output: 20, reasoning: 3, cacheRead: 4, cacheWrite: 5 },
      costUsd: 0.25,
    })
  })

  it('does not invent usage for messages without tokens', () => {
    const message = toTranscriptMessage({
      id: 'msg_2',
      type: 'assistant',
      agent: 'frontend',
      model: { providerID: 'test', id: 'test' },
      time: { created: 1 },
      content: [{ type: 'text', text: 'done' }],
    })
    expect(message?.tokens).toBeUndefined()
    expect(message?.costUsd).toBeUndefined()
  })
})

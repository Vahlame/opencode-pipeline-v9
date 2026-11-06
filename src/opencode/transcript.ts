import type { SessionMessageAssistant, SessionMessageInfo } from '@opencode/client'
import type { TranscriptMessage, TranscriptUsage } from './adapter.js'

function toUsage(tokens: NonNullable<SessionMessageAssistant['tokens']>): TranscriptUsage {
  return {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cacheRead: tokens.cache.read,
    cacheWrite: tokens.cache.write,
  }
}

export function toTranscriptMessage(message: SessionMessageInfo): TranscriptMessage | null {
  switch (message.type) {
    case 'assistant': {
      const text = message.content
        .filter((content) => content.type === 'text')
        .map((content) => content.text)
        .join('\n')
        .trim()
      return {
        id: message.id,
        role: 'assistant',
        text,
        agent: message.agent,
        createdAt: new Date(message.time.created).toISOString(),
        ...(message.tokens ? { tokens: toUsage(message.tokens) } : {}),
        ...(message.cost !== undefined ? { costUsd: message.cost } : {}),
      }
    }
    case 'user':
      return {
        id: message.id,
        role: 'user',
        text: message.text,
        createdAt: new Date(message.time.created).toISOString(),
      }
    case 'system':
    case 'synthetic':
      return {
        id: message.id,
        role: 'system',
        text: message.text,
        createdAt: new Date(message.time.created).toISOString(),
      }
    default:
      return null
  }
}

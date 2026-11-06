import { describe, expect, it } from 'vitest'
import { TokenError, TokenService } from '../../src/auth/tokens.js'
import { redact, redactText, assertNoSecret } from '../../src/security/redaction.js'

describe('signed principals', () => {
  it('issues and verifies a principal', () => {
    const tokens = new TokenService('test-secret-for-tokens-123456')
    const token = tokens.issue({
      subjectId: 'agent-1',
      kind: 'AGENT',
      role: 'SPECIALIST',
      projectId: 'prj_1',
      agentId: 'agent-1',
    })
    const payload = tokens.verify(token)
    expect(payload.agentId).toBe('agent-1')
    expect(payload.role).toBe('SPECIALIST')
  })

  it('rejects tampered tokens', () => {
    const tokens = new TokenService('test-secret-for-tokens-123456')
    const token = tokens.issue({ subjectId: 'human', kind: 'HUMAN', role: 'HUMAN' })
    const tampered = `${token.slice(0, -2)}xx`
    expect(() => tokens.verify(tampered)).toThrow(TokenError)
  })

  it('rejects expired tokens', () => {
    let now = 1_000_000
    const tokens = new TokenService('test-secret-for-tokens-123456', { now: () => now })
    const token = tokens.issue({ subjectId: 'human', kind: 'HUMAN', role: 'HUMAN' }, 10)
    now += 11_000
    expect(() => tokens.verify(token)).toThrow(/expired/i)
  })

  it('requires a strong secret', () => {
    expect(() => new TokenService('short')).toThrow(/16/)
  })
})

describe('redaction', () => {
  it('redacts sensitive keys and text', () => {
    const value = {
      password: 'secret-value',
      nested: { token: 'abc', api_key: 'xyz' },
      text: 'password=secret-value token: abc',
    }
    const result = redact(value)
    expect(JSON.stringify(result)).not.toContain('secret-value')
    expect(JSON.stringify(result)).not.toContain('abc')
    expect(JSON.stringify(result)).toContain('[REDACTED]')
    expect(redactText('authorization: Bearer abc123')).not.toContain('abc123')
  })

  it('can reject payloads that look like secrets', () => {
    expect(() => assertNoSecret({ text: 'password=secret-value' })).toThrow()
    expect(() => assertNoSecret({ text: 'safe' })).not.toThrow()
  })
})

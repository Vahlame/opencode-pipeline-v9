import { describe, expect, it } from 'vitest'
import { signArtifact, verifyArtifact } from '../../src/security/signatures.js'

describe('artifact signatures', () => {
  it('signs and verifies stable payloads with HMAC-SHA256', () => {
    const payload = { subjectId: 'delivery', hash: 'abc', projectId: 'prj' }
    const secret = 'test-secret-with-enough-length'
    const signature = signArtifact(payload, secret)
    expect(signature).toMatch(/^[0-9a-f]{64}$/)
    expect(verifyArtifact(payload, signature, secret)).toBe(true)
    expect(verifyArtifact({ ...payload, hash: 'changed' }, signature, secret)).toBe(false)
    expect(verifyArtifact(payload, signature, 'other-secret-with-enough-length')).toBe(false)
  })
})

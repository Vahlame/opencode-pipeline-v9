import { describe, expect, it } from 'vitest'
import { deterministicCommitEpoch } from '../../src/integration/manifest.js'

describe('integration manifest clock', () => {
  it('anchors the deterministic commit after the latest approval without jumping to a distant future', () => {
    const floor = Date.parse('2026-11-06T15:34:34.172Z')
    const epoch = deterministicCommitEpoch('a'.repeat(64), floor)
    expect(epoch).toBeGreaterThan(Math.floor(floor / 1000))
    expect(epoch).toBeLessThanOrEqual(Math.floor(floor / 1000) + 61)
  })
})

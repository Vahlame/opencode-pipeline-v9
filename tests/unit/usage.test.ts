import { describe, expect, it } from 'vitest'
import { createCoreFixture } from '../helpers/phase2.js'

describe('usage accounting', () => {
  it('breaks down tokens by agent, task, session and purpose', () => {
    const fixture = createCoreFixture('C:/usage')
    try {
      const frontend = fixture.agentByCode.get('frontend')!
      fixture.store.createUsageEvent({
        projectId: fixture.project.id,
        agentId: frontend.id,
        purpose: 'task',
        source: 'estimate',
        inputTokens: 100,
        outputTokens: 40,
        costUsd: 0.001,
      })
      fixture.store.createUsageEvent({
        projectId: fixture.project.id,
        agentId: frontend.id,
        purpose: 'judge:JUDGE_TESTS',
        source: 'provider',
        inputTokens: 200,
        outputTokens: 80,
        costUsd: 0.002,
      })
      const byAgent = fixture.store.usageBreakdown(fixture.project.id, 'agent')
      const agentRows = byAgent.filter((row) => row.key === frontend.id)
      expect(agentRows.reduce((sum, row) => sum + row.inputTokens, 0)).toBe(300)
      expect(agentRows.reduce((sum, row) => sum + row.entries, 0)).toBe(2)
      const byPurpose = fixture.store.usageBreakdown(fixture.project.id, 'purpose')
      expect(byPurpose.some((row) => row.key === 'judge:JUDGE_TESTS')).toBe(true)
    } finally {
      fixture.close()
    }
  })
})

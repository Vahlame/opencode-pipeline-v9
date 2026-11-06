import { describe, expect, it } from 'vitest'
import { SessionManager } from '../../src/sessions/manager.js'
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

  it('imports exact OpenCode usage once per assistant message', async () => {
    const fixture = createCoreFixture('C:/usage-exact')
    try {
      const frontend = fixture.agentByCode.get('frontend')!
      const session = fixture.store.createSession({
        projectId: fixture.project.id,
        agentId: frontend.id,
        opencodeSessionId: 'ses_exact',
        purpose: 'task',
        status: 'ACTIVE',
      })
      const transcript = [
        {
          id: 'msg_exact_1',
          role: 'assistant',
          text: 'done',
          tokens: { input: 10, output: 20, reasoning: 3, cacheRead: 4, cacheWrite: 5 },
          costUsd: 0.25,
        },
      ]
      const adapter = {
        runtime: 'http',
        waitForIdle: async () => {},
        getSession: async () => ({
          id: 'ses_exact',
          projectID: fixture.project.id,
          directory: 'C:/usage-exact',
          outcome: 'succeeded',
        }),
        getTranscript: async () => transcript,
      }
      const manager = new SessionManager(fixture.store, adapter as never)
      await manager.wait(session, 1_000)
      await manager.wait(session, 1_000)
      const exact = fixture.store
        .listUsageEvents(fixture.project.id)
        .filter((event) => event.source === 'provider')
      expect(exact).toHaveLength(1)
      expect(exact[0]).toMatchObject({
        inputTokens: 19,
        outputTokens: 23,
        costUsd: 0.25,
        requestId: 'msg_exact_1',
        purpose: 'task',
      })
    } finally {
      fixture.close()
    }
  })
})

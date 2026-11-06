import { describe, expect, it } from 'vitest'
import { MockOpenCodeAdapter } from '../../src/opencode/mock-adapter.js'
import { SessionManager } from '../../src/sessions/manager.js'
import { createCoreFixture } from '../helpers/phase2.js'

describe('mathematician agent permissions', () => {
  it('enables web research only for the mathematician and keeps edit paths scoped', async () => {
    const fixture = createCoreFixture('C:/math-agent')
    try {
      const plan = fixture.approveAndStart()
      const coordinator = fixture.principalFor('coordinador')
      const matematico = fixture.agentByCode.get('matematico')!
      const frontend = fixture.agentByCode.get('frontend')!
      const module = fixture.service.createModule(coordinator, {
        projectId: fixture.project.id,
        name: 'math',
        ownerAgentId: matematico.id,
        pathScope: ['research/math/**'],
      })
      const task = fixture.service.createTask(coordinator, {
        projectId: fixture.project.id,
        planId: plan.id,
        moduleId: module.id,
        title: 'Model',
        description: 'Mathematical model',
        ownerAgentId: matematico.id,
      })
      const contract = fixture.service.createContract(coordinator, {
        taskId: task.id,
        moduleId: module.id,
        objective: 'Model',
        allowedPaths: ['research/math/**'],
        inputInterfaces: [],
        outputInterfaces: [],
        acceptanceTests: [],
        limits: { maxDurationMinutes: 10 },
        deliveryFormat: 'MathematicalAnalysis',
      })
      const adapter = new MockOpenCodeAdapter()
      const sessions = new SessionManager(fixture.store, adapter)
      const worktree = fixture.store.createWorktree({
        taskId: task.id,
        moduleId: module.id,
        path: process.cwd(),
        branch: `test/math-${task.id}`,
        baseCommit: 'a'.repeat(40),
      })
      await sessions.createForTaskAsync({
        task,
        agent: matematico,
        contract,
        worktree,
      })
      await sessions.createForTaskAsync({
        task,
        agent: frontend,
        contract,
        worktree,
      })
      const calls = adapter.calls.filter((call) => call.method === 'createSession')
      const mathPermissions = (
        calls[0]!.input as {
          permissions: Array<{ action: string; resource: string; effect: string }>
        }
      ).permissions
      const frontendPermissions = (
        calls[1]!.input as {
          permissions: Array<{ action: string; resource: string; effect: string }>
        }
      ).permissions
      expect(
        mathPermissions.some((rule) => rule.action === 'webfetch' && rule.effect === 'allow'),
      ).toBe(true)
      expect(
        mathPermissions.some((rule) => rule.action === 'websearch' && rule.effect === 'allow'),
      ).toBe(true)
      expect(
        frontendPermissions.some((rule) => rule.action === 'webfetch' && rule.effect === 'deny'),
      ).toBe(true)
      expect(
        mathPermissions.some(
          (rule) =>
            rule.action === 'edit' &&
            rule.resource === 'research/math/**' &&
            rule.effect === 'allow',
        ),
      ).toBe(true)
    } finally {
      fixture.close()
    }
  })
})

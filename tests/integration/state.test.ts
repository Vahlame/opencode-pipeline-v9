import { describe, expect, it } from 'vitest'
import { createCoreFixture } from '../helpers/phase2.js'

describe('shared operational memory', () => {
  it('lets every authenticated agent read the same operational state without private messages', () => {
    const fixture = createCoreFixture('C:/state-shared')
    try {
      const plan = fixture.approveAndStart('Shared state plan')
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      const frontend = fixture.agentByCode.get('frontend')!
      const frontendPrincipal = fixture.tokens.verify(fixture.tokenFor('frontend'))
      const module = fixture.service.createModule(coordinator, {
        projectId: fixture.project.id,
        name: 'State module',
        ownerAgentId: frontend.id,
        pathScope: ['modules/state/**'],
      })
      const task = fixture.service.createTask(coordinator, {
        projectId: fixture.project.id,
        planId: plan.id,
        moduleId: module.id,
        title: 'State task',
        description: 'read state',
        ownerAgentId: frontend.id,
      })
      fixture.service.assignTask(coordinator, task.id, frontend.id)

      const states = fixture.agents.map((agent) => {
        const principal = fixture.tokens.verify(fixture.tokenFor(agent.opencodeAgentId))
        return fixture.service.getState(principal, fixture.project.id)
      })

      for (const state of states) {
        expect(state.project.id).toBe(fixture.project.id)
        expect(state.agents).toHaveLength(11)
        expect(state.tasks.some((item) => item.id === task.id)).toBe(true)
        expect(state.modules.some((item) => item.id === module.id)).toBe(true)
        expect(state).not.toHaveProperty('messages')
      }

      const inbox = fixture.service.listMessages(frontendPrincipal, fixture.project.id)
      expect(inbox).toEqual([])
    } finally {
      fixture.close()
    }
  })

  it('redacts secrets from persisted messages and events', () => {
    const fixture = createCoreFixture('C:/state-secrets')
    try {
      fixture.approveAndStart()
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      const frontend = fixture.agentByCode.get('frontend')!
      const frontendPrincipal = fixture.tokens.verify(fixture.tokenFor('frontend'))
      const secret = 'super-secret-value-123'
      fixture.service.sendMessage(coordinator, {
        projectId: fixture.project.id,
        toAgentId: frontend.id,
        correlationId: 'corr-secret',
        kind: 'INFO',
        payload: {
          text: `password=${secret}`,
          nested: { token: secret },
        },
        idempotencyKey: 'secret-message',
      })

      const serializedInbox = JSON.stringify(
        fixture.service.listMessages(frontendPrincipal, fixture.project.id),
      )
      const serializedEvents = JSON.stringify(
        fixture.service.listEvents(frontendPrincipal, fixture.project.id),
      )
      expect(serializedInbox).not.toContain(secret)
      expect(serializedEvents).not.toContain(secret)
      expect(serializedInbox).toContain('[REDACTED]')
    } finally {
      fixture.close()
    }
  })

  it('exposes contracts, versions and reviews as shared read-only data', () => {
    const fixture = createCoreFixture('C:/state-artifacts')
    try {
      const plan = fixture.approveAndStart()
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      const frontend = fixture.agentByCode.get('frontend')!
      const frontendPrincipal = fixture.tokens.verify(fixture.tokenFor('frontend'))
      const testing = fixture.tokens.verify(fixture.tokenFor('testing'))
      const module = fixture.service.createModule(coordinator, {
        projectId: fixture.project.id,
        name: 'Artifacts module',
        ownerAgentId: frontend.id,
        pathScope: ['modules/artifacts/**'],
      })
      const version = fixture.service.createModuleVersion(frontendPrincipal, {
        moduleId: module.id,
        commitSha: 'a'.repeat(40),
        treeHash: 'tree-1',
        artifactHash: 'artifact-1',
      })
      const task = fixture.service.createTask(coordinator, {
        projectId: fixture.project.id,
        planId: plan.id,
        moduleId: module.id,
        title: 'Artifacts task',
        description: 'contracts',
        ownerAgentId: frontend.id,
      })
      const contract = fixture.service.createContract(coordinator, {
        taskId: task.id,
        moduleId: module.id,
        objective: 'artifact contract',
        allowedPaths: ['modules/artifacts/**'],
        inputInterfaces: ['in'],
        outputInterfaces: ['out'],
        acceptanceTests: ['test'],
        limits: { maxDurationMinutes: 30 },
        deliveryFormat: 'DeliveryDraft',
      })
      const review = fixture.service.submitReview(testing, {
        moduleVersionId: version.id,
        judgeRole: 'JUDGE_TESTS',
        verdict: 'APPROVE',
        findings: [],
        evidence: ['tests passed'],
      })

      const state = fixture.service.getState(frontendPrincipal, fixture.project.id)
      expect(state.contracts.find((item) => item.id === contract.id)?.objective).toBe(
        'artifact contract',
      )
      expect(state.modules.find((item) => item.id === module.id)?.versions[0]?.id).toBe(version.id)
      expect(state.reviews.find((item) => item.id === review.id)?.verdict).toBe('APPROVE')
    } finally {
      fixture.close()
    }
  })
})

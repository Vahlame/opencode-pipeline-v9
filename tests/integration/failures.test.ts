import { describe, expect, it } from 'vitest'
import { ConflictError } from '../../src/orchestrator/errors.js'
import { createCoreFixture } from '../helpers/phase2.js'

describe('failure atomicity', () => {
  it('does not approve a plan with the wrong hash or leave partial records', () => {
    const fixture = createCoreFixture('C:/failure-plan')
    try {
      const parent = fixture.tokens.verify(fixture.tokenFor('padre'))
      const human = fixture.tokens.verify(fixture.human)
      const plan = fixture.service.createPlan(parent, {
        projectId: fixture.project.id,
        title: 'Failure plan',
        spec: { objective: 'failure' },
        plan: { steps: [] },
      })
      const eventsBefore = fixture.store.listEvents(fixture.project.id, 100).length
      const approvalsBefore = fixture.store.listApprovals(fixture.project.id).length

      expect(() => fixture.service.approvePlan(human, plan.id, 'wrong-hash')).toThrow(ConflictError)
      expect(fixture.store.getPlan(plan.id)?.status).toBe('PROPOSED')
      expect(fixture.store.listApprovals(fixture.project.id)).toHaveLength(approvalsBefore)
      expect(fixture.store.listEvents(fixture.project.id, 100)).toHaveLength(eventsBefore)
    } finally {
      fixture.close()
    }
  })

  it('does not create a task when a dependency is invalid', () => {
    const fixture = createCoreFixture('C:/failure-task')
    try {
      const plan = fixture.approveAndStart()
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      const tasksBefore = fixture.store.countTable('tasks')
      const eventsBefore = fixture.store.countTable('events')

      expect(() =>
        fixture.service.createTask(coordinator, {
          projectId: fixture.project.id,
          planId: plan.id,
          title: 'Invalid task',
          description: 'invalid dependency',
          dependsOn: ['tsk_missing' as never],
        }),
      ).toThrow(/Dependency/)

      expect(fixture.store.countTable('tasks')).toBe(tasksBefore)
      expect(fixture.store.countTable('events')).toBe(eventsBefore)
    } finally {
      fixture.close()
    }
  })

  it('does not record a review twice for the same judge and version', () => {
    const fixture = createCoreFixture('C:/failure-review')
    try {
      const plan = fixture.approveAndStart()
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      const frontend = fixture.agentByCode.get('frontend')!
      const frontendPrincipal = fixture.tokens.verify(fixture.tokenFor('frontend'))
      const testing = fixture.tokens.verify(fixture.tokenFor('testing'))
      const module = fixture.service.createModule(coordinator, {
        projectId: fixture.project.id,
        name: 'Review module',
        ownerAgentId: frontend.id,
        pathScope: ['modules/review/**'],
      })
      const version = fixture.service.createModuleVersion(frontendPrincipal, {
        moduleId: module.id,
        commitSha: 'b'.repeat(40),
        treeHash: 'tree-review',
        artifactHash: 'artifact-review',
      })
      const task = fixture.service.createTask(coordinator, {
        projectId: fixture.project.id,
        planId: plan.id,
        moduleId: module.id,
        title: 'Review task',
        description: 'review',
      })
      const contract = fixture.service.createContract(coordinator, {
        taskId: task.id,
        moduleId: module.id,
        objective: 'review contract',
        allowedPaths: ['modules/review/**'],
        inputInterfaces: [],
        outputInterfaces: [],
        acceptanceTests: ['test'],
        limits: { maxDurationMinutes: 10 },
        deliveryFormat: 'DeliveryDraft',
      })
      expect(contract.version).toBe(1)

      fixture.service.submitReview(testing, {
        moduleVersionId: version.id,
        judgeRole: 'JUDGE_TESTS',
        verdict: 'APPROVE',
        findings: [],
        evidence: ['pass'],
      })
      const eventsBefore = fixture.store.countTable('events')
      fixture.service.submitReview(testing, {
        moduleVersionId: version.id,
        judgeRole: 'JUDGE_TESTS',
        verdict: 'APPROVE',
        findings: [],
        evidence: ['pass'],
      })
      expect(fixture.store.countTable('reviews')).toBe(1)
      expect(fixture.store.countTable('events')).toBe(eventsBefore)
    } finally {
      fixture.close()
    }
  })
})

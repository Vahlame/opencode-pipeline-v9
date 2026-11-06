import { describe, expect, it } from 'vitest'
import { AuthorizationService } from '../../src/auth/authorization.js'
import type { AgentId, ModuleId, TaskId } from '../../src/domain/ids.js'
import { createCoreFixture } from '../helpers/phase2.js'

describe('AuthorizationService', () => {
  it('lets the parent propose and the human approve a plan', () => {
    const fixture = createCoreFixture('C:/auth-plan')
    try {
      const authz = new AuthorizationService(fixture.store)
      const parent = fixture.tokens.verify(fixture.tokenFor('padre'))
      const specialist = fixture.tokens.verify(fixture.tokenFor('frontend'))
      const human = fixture.tokens.verify(fixture.human)

      expect(
        authz.check(parent, 'plan.propose', {
          type: 'project',
          id: fixture.project.id,
        }).allowed,
      ).toBe(true)
      expect(
        authz.check(specialist, 'plan.propose', {
          type: 'project',
          id: fixture.project.id,
        }).allowed,
      ).toBe(false)

      const plan = fixture.service.createPlan(parent, {
        projectId: fixture.project.id,
        title: 'Auth plan',
        spec: { objective: 'auth' },
        plan: { steps: [] },
      })
      expect(() => fixture.service.approvePlan(parent, plan.id, plan.hash)).toThrow()
      const approved = fixture.service.approvePlan(human, plan.id, plan.hash)
      expect(approved.status).toBe('APPROVED')
    } finally {
      fixture.close()
    }
  })

  it('lets the coordinator assign/prioritize/pause and denies a specialist', () => {
    const fixture = createCoreFixture('C:/auth-coordinator')
    try {
      fixture.approveAndStart()
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      const specialist = fixture.tokens.verify(fixture.tokenFor('frontend'))
      const backend = fixture.tokens.verify(fixture.tokenFor('backend'))
      const plan = fixture.store.listPlans(fixture.project.id)[0]!
      const task = fixture.service.createTask(coordinator, {
        projectId: fixture.project.id,
        planId: plan.id,
        title: 'Coordinator task',
        description: 'test',
      })

      expect(() =>
        fixture.service.assignTask(specialist, task.id, backend.agentId as AgentId),
      ).toThrow(/Authorization/)
      expect(() => fixture.service.prioritizeTask(specialist, task.id, 99)).toThrow(/Authorization/)

      const assigned = fixture.service.assignTask(coordinator, task.id, backend.agentId as AgentId)
      expect(assigned.ownerAgentId).toBe(backend.agentId)
      expect(assigned.state).toBe('READY')
      const prioritized = fixture.service.prioritizeTask(coordinator, task.id, 88)
      expect(prioritized.priority).toBe(88)
      const paused = fixture.service.pauseTask(coordinator, task.id)
      expect(paused.state).toBe('PAUSED')
      const cancelled = fixture.service.cancelTask(coordinator, task.id)
      expect(cancelled.state).toBe('CANCELLED')
    } finally {
      fixture.close()
    }
  })

  it('enforces module ownership and judge read-only behavior', () => {
    const fixture = createCoreFixture('C:/auth-module')
    try {
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      const frontend = fixture.tokens.verify(fixture.tokenFor('frontend'))
      const backend = fixture.tokens.verify(fixture.tokenFor('backend'))
      const judge = fixture.tokens.verify(fixture.tokenFor('testing'))
      fixture.approveAndStart()
      const module = fixture.service.createModule(coordinator, {
        projectId: fixture.project.id,
        name: 'Frontend module',
        ownerAgentId: frontend.agentId as AgentId,
        pathScope: ['modules/frontend/**'],
      })
      const authz = new AuthorizationService(fixture.store)

      expect(authz.check(frontend, 'module.write', { type: 'module', id: module.id }).allowed).toBe(
        true,
      )
      expect(authz.check(backend, 'module.write', { type: 'module', id: module.id }).allowed).toBe(
        false,
      )
      expect(authz.check(judge, 'module.write', { type: 'module', id: module.id }).allowed).toBe(
        false,
      )
    } finally {
      fixture.close()
    }
  })

  it('lets the coordinator approve a contract change but not a specialist', () => {
    const fixture = createCoreFixture('C:/auth-contract')
    try {
      const plan = fixture.approveAndStart()
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      const frontend = fixture.agentByCode.get('frontend')!
      const frontendPrincipal = fixture.tokens.verify(fixture.tokenFor('frontend'))
      const module = fixture.service.createModule(coordinator, {
        projectId: fixture.project.id,
        name: 'Contract module',
        ownerAgentId: frontend.id,
        pathScope: ['modules/contract/**'],
      })
      const task = fixture.service.createTask(coordinator, {
        projectId: fixture.project.id,
        planId: plan.id,
        moduleId: module.id,
        title: 'Contract task',
        description: 'contract approval',
      })
      const contract = fixture.service.createContract(coordinator, {
        taskId: task.id,
        moduleId: module.id,
        objective: 'contract approval',
        allowedPaths: ['modules/contract/**'],
        inputInterfaces: [],
        outputInterfaces: [],
        acceptanceTests: ['test'],
        limits: { maxDurationMinutes: 10 },
        deliveryFormat: 'DeliveryDraft',
      })

      expect(() =>
        fixture.service.recordApproval(frontendPrincipal, {
          projectId: fixture.project.id,
          subjectType: 'CONTRACT',
          subjectId: contract.id,
          subjectHash: contract.hash,
          decision: 'APPROVED',
        }),
      ).toThrow(/Authorization/)

      const approval = fixture.service.recordApproval(coordinator, {
        projectId: fixture.project.id,
        subjectType: 'CONTRACT',
        subjectId: contract.id,
        subjectHash: contract.hash,
        decision: 'APPROVED',
      })
      expect(approval.subjectType).toBe('CONTRACT')
      expect(approval.approverId).toBe(coordinator.agentId)
    } finally {
      fixture.close()
    }
  })

  it('rechecks the persisted role and rejects a forged/stale role', () => {
    const fixture = createCoreFixture('C:/auth-forged')
    try {
      const frontend = fixture.agentByCode.get('frontend')!
      const forged = fixture.tokens.issue({
        subjectId: frontend.id,
        kind: 'AGENT',
        role: 'COORDINATOR',
        projectId: fixture.project.id,
        agentId: frontend.id,
      })
      const authz = new AuthorizationService(fixture.store)
      const decision = authz.check(fixture.tokens.verify(forged), 'task.create', {
        type: 'project',
        id: fixture.project.id,
      })
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('ROLE_STALE')
    } finally {
      fixture.close()
    }
  })

  it('allows a temporary grant and records the decision', () => {
    const fixture = createCoreFixture('C:/auth-temp')
    try {
      fixture.approveAndStart()
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      const specialist = fixture.tokens.verify(fixture.tokenFor('frontend'))
      const plan = fixture.store.listPlans(fixture.project.id)[0]!
      const task = fixture.service.createTask(coordinator, {
        projectId: fixture.project.id,
        planId: plan.id,
        title: 'Temporary grant task',
        description: 'test',
      })

      const resource = `task:${task.id}:${fixture.project.id}`
      fixture.service.grantTemporaryPermission(fixture.tokens.verify(fixture.human), {
        projectId: fixture.project.id,
        principalId: specialist.agentId!,
        action: 'task.assign',
        resource,
        effect: 'allow',
        ttlSeconds: 60,
      })
      const authz = new AuthorizationService(fixture.store)
      const decision = authz.check(specialist, 'task.assign', { type: 'task', id: task.id })
      expect(decision.allowed).toBe(true)
      expect(decision.reason).toBe('TEMPORARY_PERMISSION_ALLOWED')
    } finally {
      fixture.close()
    }
  })

  it('records denied authorization decisions with the project id', () => {
    const fixture = createCoreFixture('C:/auth-audit')
    try {
      const specialist = fixture.tokens.verify(fixture.tokenFor('frontend'))
      const authz = new AuthorizationService(fixture.store)
      const decision = authz.check(specialist, 'task.assign', {
        type: 'task',
        id: 'tsk_missing' as TaskId,
      })
      expect(decision.allowed).toBe(false)
      const denied = fixture.store.listAudit(fixture.project.id, 'DENY')
      expect(denied.length).toBeGreaterThan(0)
      expect(denied[0]?.projectId).toBe(fixture.project.id)
    } finally {
      fixture.close()
    }
  })

  it('exposes branded module and agent ids for ownership checks', () => {
    const fixture = createCoreFixture('C:/auth-ids')
    try {
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      const frontend = fixture.agentByCode.get('frontend')!
      fixture.approveAndStart()
      const module = fixture.service.createModule(coordinator, {
        projectId: fixture.project.id,
        name: 'IDs module',
        ownerAgentId: frontend.id as AgentId,
        pathScope: ['modules/ids/**'],
      })
      expect(module.id).toMatch(/^mod_/)
      expect(module.ownerAgentId).toBe(frontend.id)
      expect(module.id as ModuleId).toBeTruthy()
    } finally {
      fixture.close()
    }
  })
})

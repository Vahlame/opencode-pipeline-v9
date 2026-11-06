import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AuthorizationService } from '../../src/auth/authorization.js'
import { WorktreeManager } from '../../src/worktrees/manager.js'
import { RecoveryManager } from '../../src/recovery/manager.js'
import { createCoreFixture } from '../helpers/phase2.js'

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'orch-recovery-'))
}

function managerFor(root: string, store: ReturnType<typeof createCoreFixture>['store']) {
  const worktrees = new WorktreeManager(root, join(root, '.worktrees'))
  return new RecoveryManager(
    store,
    new AuthorizationService(store),
    worktrees,
    {
      staleMinutes: 1,
      taskMaxAttempts: 3,
      leaseSeconds: 60,
      operationLeaseSeconds: 60,
    },
    { getSession: async () => null },
  )
}

describe('RecoveryManager', () => {
  it('recovers an interrupted task, session and lease without duplicating attempts', async () => {
    const root = tempRoot()
    const fixture = createCoreFixture(root)
    try {
      const plan = fixture.approveAndStart()
      const coordinator = fixture.principalFor('coordinador')
      const frontend = fixture.agentByCode.get('frontend')!
      const module = fixture.service.createModule(coordinator, {
        projectId: fixture.project.id,
        name: 'recovery-module',
        ownerAgentId: frontend.id,
        pathScope: ['modules/recovery/**'],
      })
      const task = fixture.service.createTask(coordinator, {
        projectId: fixture.project.id,
        planId: plan.id,
        moduleId: module.id,
        title: 'Interrupted task',
        description: 'Interrupted task',
        ownerAgentId: frontend.id,
      })
      fixture.service.createContract(coordinator, {
        taskId: task.id,
        moduleId: module.id,
        objective: 'Recovery',
        allowedPaths: ['modules/recovery/**'],
        inputInterfaces: [],
        outputInterfaces: [],
        acceptanceTests: [],
        limits: { maxDurationMinutes: 10 },
        deliveryFormat: 'DeliveryDraft',
      })
      fixture.store.updateTaskState(task.id, 'READY')
      fixture.store.incrementTaskAttempt(task.id)
      fixture.store.updateTaskState(task.id, 'RUNNING')
      fixture.store.createLease({
        taskId: task.id,
        ownerId: 'test',
        attempt: 1,
        expiresAt: '2020-01-01T00:00:00.000Z',
      })
      fixture.store.setTaskLease(task.id, '2020-01-01T00:00:00.000Z')
      const attempt = fixture.store.createTaskAttempt({ taskId: task.id, attempt: 1 })
      const session = fixture.store.createSession({
        projectId: fixture.project.id,
        agentId: frontend.id,
        opencodeSessionId: 'opencode-recovery',
        worktreePath: join(root, 'missing-worktree'),
        status: 'ACTIVE',
      })

      const recovery = managerFor(root, fixture.store)
      const result = await recovery.run(fixture.tokens.verify(fixture.human), fixture.project.id, {
        apply: true,
      })
      expect(result.actions.some((action) => action.code === 'SESSION_MISSING_IN_OPENCODE')).toBe(
        true,
      )
      expect(result.actions.some((action) => action.code === 'LEASE_EXPIRED')).toBe(true)
      expect(fixture.store.getTask(task.id)?.state).toBe('READY')
      expect(fixture.store.getLease(task.id)).toBeUndefined()
      expect(fixture.store.getTaskAttempt(attempt.id)?.status).toBe('INTERRUPTED')
      expect(fixture.store.getSession(session.id)?.status).toBe('STOPPED')
      expect(fixture.store.listTaskAttempts(task.id)).toHaveLength(1)
    } finally {
      fixture.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('marks an interrupted integration failed and returns the project to RUNNING', async () => {
    const root = tempRoot()
    const fixture = createCoreFixture(root)
    try {
      const plan = fixture.approveAndStart()
      const run = fixture.store.createIntegrationRun({
        projectId: fixture.project.id,
        planId: plan.id,
        attempt: 1,
        baseCommit: 'a'.repeat(40),
        integrationPath: join(root, '.worktrees', 'integrations', 'interrupted'),
        inputHash: 'interrupted',
      })
      const project = fixture.store.getProject(fixture.project.id)!
      fixture.store.updateProjectStatus(project.id, 'INTEGRATING', project.version)
      const recovery = managerFor(root, fixture.store)
      const result = await recovery.run(fixture.tokens.verify(fixture.human), fixture.project.id, {
        apply: true,
      })
      expect(result.actions.some((action) => action.code === 'INTEGRATION_RUN_INTERRUPTED')).toBe(
        true,
      )
      expect(fixture.store.getIntegrationRun(run.id)?.status).toBe('FAILED')
      expect(fixture.store.getProject(fixture.project.id)?.status).toBe('RUNNING')
    } finally {
      fixture.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('cancels a superseded rework task but leaves unrelated pending work visible', async () => {
    const root = tempRoot()
    const fixture = createCoreFixture(root)
    try {
      const plan = fixture.approveAndStart()
      const coordinator = fixture.principalFor('coordinador')
      const frontend = fixture.agentByCode.get('frontend')!
      const module = fixture.service.createModule(coordinator, {
        projectId: fixture.project.id,
        name: 'superseded',
        ownerAgentId: frontend.id,
        pathScope: ['modules/superseded/**'],
      })
      const oldTask = fixture.service.createTask(coordinator, {
        projectId: fixture.project.id,
        planId: plan.id,
        moduleId: module.id,
        title: 'Old',
        description: 'Old rework',
        ownerAgentId: frontend.id,
      })
      const newTask = fixture.store.createTask({
        projectId: fixture.project.id,
        planId: plan.id,
        moduleId: module.id,
        title: 'New',
        description: 'New rework',
        ownerAgentId: frontend.id,
        reviewCycle: 1,
      })
      fixture.store.updateTaskState(oldTask.id, 'REWORK_REQUIRED')
      fixture.store.updateTaskState(newTask.id, 'INTEGRATED')
      const recovery = managerFor(root, fixture.store)
      const result = await recovery.run(fixture.tokens.verify(fixture.human), fixture.project.id, {
        apply: true,
      })
      expect(result.actions.some((action) => action.code === 'TASK_SUPERSEDED_REWORK')).toBe(true)
      expect(fixture.store.getTask(oldTask.id)?.state).toBe('CANCELLED')
      expect(fixture.store.getTask(newTask.id)?.state).toBe('INTEGRATED')
    } finally {
      fixture.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports queued messages without duplicating them', async () => {
    const root = tempRoot()
    const fixture = createCoreFixture(root)
    try {
      fixture.approveAndStart()
      const coordinator = fixture.principalFor('coordinador')
      const frontend = fixture.agentByCode.get('frontend')!
      const sent = fixture.service.sendMessage(coordinator, {
        projectId: fixture.project.id,
        toAgentId: frontend.id,
        correlationId: 'recovery-message',
        kind: 'INFO',
        payload: { text: 'pending' },
        idempotencyKey: 'recovery-message',
      })
      const recovery = managerFor(root, fixture.store)
      const result = await recovery.run(fixture.tokens.verify(fixture.human), fixture.project.id, {
        apply: true,
      })
      expect(result.actions.some((action) => action.code === 'MESSAGES_PENDING')).toBe(true)
      expect(fixture.store.getMessage(sent.message.id)?.state).toBe('QUEUED')
      expect(
        fixture.store.getMessageByIdempotency(fixture.project.id, 'recovery-message')?.id,
      ).toBe(sent.message.id)
    } finally {
      fixture.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('is idempotent when the persisted state did not change', async () => {
    const root = tempRoot()
    const fixture = createCoreFixture(root)
    try {
      fixture.approveAndStart()
      const recovery = managerFor(root, fixture.store)
      const human = fixture.tokens.verify(fixture.human)
      const first = await recovery.run(human, fixture.project.id, { apply: true })
      const second = await recovery.run(human, fixture.project.id, { apply: true })
      expect(second.reused).toBe(true)
      expect(second.run.id).toBe(first.run.id)
      expect(fixture.store.listRecoveryRuns(fixture.project.id)).toHaveLength(1)
    } finally {
      fixture.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

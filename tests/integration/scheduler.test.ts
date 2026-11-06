import { describe, expect, it } from 'vitest'
import { AuthorizationService } from '../../src/auth/authorization.js'
import type { Module, Plan } from '../../src/domain/index.js'
import type { TaskId } from '../../src/domain/ids.js'
import type { TaskExecutor } from '../../src/orchestrator/task-executor.js'
import type { TaskClaim, TaskExecutionResult } from '../../src/orchestrator/execution-types.js'
import { Scheduler } from '../../src/orchestrator/scheduler.js'
import type { CoreFixture } from '../helpers/phase2.js'
import { createCoreFixture } from '../helpers/phase2.js'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createTask(
  fixture: CoreFixture,
  plan: Plan,
  module: Module,
  owner: string,
  title: string,
  dependsOn: TaskId[] = [],
) {
  const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
  const task = fixture.service.createTask(coordinator, {
    projectId: fixture.project.id,
    planId: plan.id,
    moduleId: module.id,
    title,
    description: 'scheduler test',
    ownerAgentId: owner as never,
    dependsOn,
  })
  fixture.service.createContract(coordinator, {
    taskId: task.id,
    moduleId: module.id,
    objective: `${title} objective`,
    allowedPaths: module.pathScope,
    inputInterfaces: [],
    outputInterfaces: [],
    acceptanceTests: [],
    limits: { maxDurationMinutes: 10 },
    deliveryFormat: 'DeliveryDraft',
  })
  return task
}

function fakeExecutor(
  fixture: CoreFixture,
  delayMs: number,
  maxActive: { value: number },
): TaskExecutor {
  let active = 0
  return {
    execute: async (claim: TaskClaim): Promise<TaskExecutionResult> => {
      active += 1
      maxActive.value = Math.max(maxActive.value, active)
      const startedAt = new Date().toISOString()
      await delay(delayMs)
      active -= 1
      fixture.store.deleteLease(claim.task.id)
      fixture.store.setTaskLease(claim.task.id, null)
      return {
        taskId: claim.task.id,
        status: 'SUCCEEDED',
        startedAt,
        endedAt: new Date().toISOString(),
      }
    },
  } as unknown as TaskExecutor
}

describe('DAG scheduler', () => {
  it('does not execute anything without an approved plan and running project', () => {
    const fixture = createCoreFixture('C:/scheduler-gate')
    try {
      const scheduler = new Scheduler(
        fixture.store,
        new AuthorizationService(fixture.store),
        fakeExecutor(fixture, 1, { value: 0 }),
        { maxParallel: 2, leaseSeconds: 60, taskMaxAttempts: 3 },
      )
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      expect(scheduler.claimReadyTasks(coordinator, fixture.project.id)).toEqual([])
    } finally {
      fixture.close()
    }
  })

  it('claims two independent tasks and executes them concurrently', async () => {
    const fixture = createCoreFixture('C:/scheduler-parallel')
    try {
      const plan = fixture.approveAndStart()
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      const frontend = fixture.agentByCode.get('frontend')!
      const backend = fixture.agentByCode.get('backend')!
      const moduleA = fixture.service.createModule(coordinator, {
        projectId: fixture.project.id,
        name: 'parallel-a',
        ownerAgentId: frontend.id,
        pathScope: ['modules/frontend/**'],
      })
      const moduleB = fixture.service.createModule(coordinator, {
        projectId: fixture.project.id,
        name: 'parallel-b',
        ownerAgentId: backend.id,
        pathScope: ['modules/backend/**'],
      })
      createTask(fixture, plan, moduleA, frontend.id, 'Independent A')
      createTask(fixture, plan, moduleB, backend.id, 'Independent B')

      const maxActive = { value: 0 }
      const scheduler = new Scheduler(
        fixture.store,
        new AuthorizationService(fixture.store),
        fakeExecutor(fixture, 80, maxActive),
        { maxParallel: 2, leaseSeconds: 60, taskMaxAttempts: 3 },
      )
      const results = await scheduler.runOnce(coordinator, fixture.project.id)
      expect(results).toHaveLength(2)
      expect(results.every((result) => result.status === 'SUCCEEDED')).toBe(true)
      expect(maxActive.value).toBe(2)
    } finally {
      fixture.close()
    }
  })

  it('does not claim a dependent task before its predecessor is approved', async () => {
    const fixture = createCoreFixture('C:/scheduler-dependency')
    try {
      const plan = fixture.approveAndStart()
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      const frontend = fixture.agentByCode.get('frontend')!
      const moduleA = fixture.service.createModule(coordinator, {
        projectId: fixture.project.id,
        name: 'dependency-a',
        ownerAgentId: frontend.id,
        pathScope: ['modules/frontend/**'],
      })
      const moduleB = fixture.service.createModule(coordinator, {
        projectId: fixture.project.id,
        name: 'dependency-b',
        ownerAgentId: frontend.id,
        pathScope: ['modules/frontend/**'],
      })
      const taskA = createTask(fixture, plan, moduleA, frontend.id, 'Predecessor')
      const taskB = createTask(fixture, plan, moduleB, frontend.id, 'Dependent', [taskA.id])
      const scheduler = new Scheduler(
        fixture.store,
        new AuthorizationService(fixture.store),
        fakeExecutor(fixture, 10, { value: 0 }),
        { maxParallel: 2, leaseSeconds: 60, taskMaxAttempts: 3 },
      )
      const first = await scheduler.runOnce(coordinator, fixture.project.id)
      expect(first).toHaveLength(1)
      expect(first[0]?.taskId).toBe(taskA.id)
      expect(fixture.store.getTask(taskB.id)?.state).toBe('PENDING')

      fixture.store.updateTaskState(taskA.id, 'IN_REVIEW')
      fixture.store.updateTaskState(taskA.id, 'APPROVED')
      const second = await scheduler.runOnce(coordinator, fixture.project.id)
      expect(second.map((result) => result.taskId)).toContain(taskB.id)
    } finally {
      fixture.close()
    }
  })

  it('does not claim the same task twice under concurrent claims', () => {
    const fixture = createCoreFixture('C:/scheduler-duplicate')
    try {
      const plan = fixture.approveAndStart()
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      const frontend = fixture.agentByCode.get('frontend')!
      const module = fixture.service.createModule(coordinator, {
        projectId: fixture.project.id,
        name: 'duplicate',
        ownerAgentId: frontend.id,
        pathScope: ['modules/frontend/**'],
      })
      const task = createTask(fixture, plan, module, frontend.id, 'Only once')
      const scheduler = new Scheduler(
        fixture.store,
        new AuthorizationService(fixture.store),
        fakeExecutor(fixture, 1, { value: 0 }),
        { maxParallel: 2, leaseSeconds: 60, taskMaxAttempts: 3 },
      )
      const first = scheduler.claimReadyTasks(coordinator, fixture.project.id)
      const second = scheduler.claimReadyTasks(coordinator, fixture.project.id)
      expect(first.map((claim) => claim.task.id)).toEqual([task.id])
      expect(second).toEqual([])
    } finally {
      fixture.close()
    }
  })
})

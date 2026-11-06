import { describe, expect, it } from 'vitest'
import {
  ContractSchema,
  ProjectIdSchema,
  ProjectSchema,
  ReviewSchema,
  TaskIdSchema,
  TaskSchema,
} from '../../src/domain/index.js'

describe('domain schemas', () => {
  it('parses a valid project', () => {
    const project = ProjectSchema.parse({
      id: ProjectIdSchema.parse('prj_01'),
      name: 'Orchestrator',
      repoPath: 'C:/repo',
      status: 'DRAFT',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: 0,
    })

    expect(project.id).toBe('prj_01')
    expect(project.status).toBe('DRAFT')
  })

  it('rejects an invalid project status', () => {
    expect(() =>
      ProjectSchema.parse({
        id: 'prj_01',
        name: 'Orchestrator',
        repoPath: 'C:/repo',
        status: 'NOT_A_STATE',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 0,
      }),
    ).toThrow()
  })

  it('parses a task and a contract', () => {
    const taskId = TaskIdSchema.parse('task_01')
    const task = TaskSchema.parse({
      id: taskId,
      projectId: 'prj_01',
      planId: 'plan_01',
      title: 'Backend endpoint',
      description: 'Implement the endpoint',
      state: 'READY',
      priority: 50,
      attemptCount: 0,
      maxAttempts: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: 0,
    })

    expect(task.state).toBe('READY')

    const contract = ContractSchema.parse({
      id: 'contract_01',
      taskId,
      moduleId: 'mod_01',
      version: 1,
      objective: 'Implement endpoint',
      allowedPaths: ['modules/backend/**'],
      inputInterfaces: ['Request'],
      outputInterfaces: ['Response'],
      acceptanceTests: ['GET /health returns 200'],
      limits: { maxDurationMinutes: 30 },
      deliveryFormat: 'DeliveryDraft',
      hash: 'sha256:abc',
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    expect(contract.allowedPaths).toEqual(['modules/backend/**'])
  })

  it('parses a judge review bound to a module version', () => {
    const review = ReviewSchema.parse({
      id: 'review_01',
      projectId: 'prj_01',
      moduleVersionId: 'modver_01',
      judgeRole: 'JUDGE_TESTS',
      verdict: 'APPROVE',
      findings: [],
      evidence: ['tests passed'],
      hash: 'sha256:review',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    expect(review.verdict).toBe('APPROVE')
  })
})

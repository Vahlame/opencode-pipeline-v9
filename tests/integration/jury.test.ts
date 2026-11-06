import { describe, expect, it } from 'vitest'
import type { Finding, Plan, Review } from '../../src/domain/index.js'
import type { AgentId, ModuleVersionId, ProjectId } from '../../src/domain/ids.js'
import { JuryDecisionService } from '../../src/jury/decision.js'
import { JuryVerdictService } from '../../src/jury/verdict.js'
import { SessionManager } from '../../src/sessions/manager.js'
import { MockOpenCodeAdapter } from '../../src/opencode/index.js'
import { createCoreFixture } from '../helpers/phase2.js'

function review(
  projectId: ProjectId,
  moduleVersionId: ModuleVersionId,
  judgeRole: Review['judgeRole'],
  options: {
    verdict?: Review['verdict']
    findings?: Finding[]
    evidence?: string[]
  } = {},
): Review {
  return {
    id: `rev_${judgeRole}` as Review['id'],
    projectId,
    moduleVersionId,
    judgeRole,
    verdict: options.verdict ?? 'APPROVE',
    findings: options.findings ?? [],
    evidence: options.evidence ?? ['evidence'],
    hash: `hash_${judgeRole}`,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function fourReviews(
  projectId: ProjectId,
  moduleVersionId: ModuleVersionId,
  options: { testsVerdict?: Review['verdict']; optimizationFindings?: Finding[] } = {},
): Review[] {
  return [
    review(projectId, moduleVersionId, 'JUDGE_TESTS', {
      verdict: options.testsVerdict ?? 'APPROVE',
    }),
    review(projectId, moduleVersionId, 'JUDGE_DEBUG'),
    review(projectId, moduleVersionId, 'JUDGE_ARCHITECTURE'),
    review(projectId, moduleVersionId, 'JUDGE_OPTIMIZATION', {
      findings: options.optimizationFindings ?? [],
    }),
  ]
}

function createModuleTaskVersion(
  fixture: ReturnType<typeof createCoreFixture>,
  plan: Plan,
  name: string,
) {
  const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
  const frontend = fixture.agentByCode.get('frontend')!
  const module = fixture.service.createModule(coordinator, {
    projectId: fixture.project.id,
    name,
    ownerAgentId: frontend.id,
    pathScope: [`modules/${name}/**`],
  })
  const task = fixture.service.createTask(coordinator, {
    projectId: fixture.project.id,
    planId: plan.id,
    moduleId: module.id,
    title: name,
    description: name,
    ownerAgentId: frontend.id,
  })
  const contract = fixture.service.createContract(coordinator, {
    taskId: task.id,
    moduleId: module.id,
    objective: name,
    allowedPaths: [`modules/${name}/**`],
    inputInterfaces: [],
    outputInterfaces: [],
    acceptanceTests: ['node test.mjs'],
    limits: { maxDurationMinutes: 10 },
    deliveryFormat: 'DeliveryDraft',
  })
  const frontendPrincipal = fixture.tokens.verify(fixture.tokenFor('frontend'))
  const version = fixture.service.createModuleVersion(frontendPrincipal, {
    moduleId: module.id,
    commitSha: hashFor(name),
    treeHash: `tree-${name}`,
    artifactHash: `artifact-${name}`,
  })
  fixture.store.updateTaskState(task.id, 'IN_REVIEW')
  const juryRun = fixture.store.createJuryRun({
    projectId: fixture.project.id,
    taskId: task.id,
    moduleVersionId: version.id,
    cycle: 0,
  })
  return { module, task, contract, version, frontendId: frontend.id, juryRunId: juryRun.id }
}

function hashFor(value: string): string {
  return Buffer.from(value.padEnd(40, 'a')).toString('hex').slice(0, 40).padEnd(40, 'a')
}

describe('Jury decisions', () => {
  it('approves a module and records it in the approved registry', () => {
    const fixture = createCoreFixture('C:/jury-approve')
    try {
      const plan = fixture.approveAndStart()
      const { module, task, version, juryRunId } = createModuleTaskVersion(
        fixture,
        plan,
        'approved',
      )
      const verdict = new JuryVerdictService().consolidate(
        fourReviews(fixture.project.id, version.id),
        { moduleVersionId: version.id, commitSha: version.commitSha },
      )
      const decision = new JuryDecisionService(fixture.store, { maxReworkCycles: 2 }).apply({
        projectId: fixture.project.id,
        taskId: task.id,
        moduleVersionId: version.id,
        juryRunId,
        consolidation: verdict,
      })
      expect(decision.verdict).toBe('APPROVED')
      expect(fixture.store.getModule(module.id)?.status).toBe('APPROVED')
      expect(fixture.store.getModuleVersion(version.id)?.status).toBe('APPROVED')
      expect(fixture.store.getTask(task.id)?.state).toBe('APPROVED')
      expect(fixture.store.getApprovedModuleByVersion(version.id)?.commitSha).toBe(
        version.commitSha,
      )
    } finally {
      fixture.close()
    }
  })

  it('returns only the rejected module to its author and preserves other modules', () => {
    const fixture = createCoreFixture('C:/jury-rework')
    try {
      const plan = fixture.approveAndStart()
      const first = createModuleTaskVersion(fixture, plan, 'first')
      const second = createModuleTaskVersion(fixture, plan, 'second')
      const verdict = new JuryVerdictService().consolidate(
        fourReviews(fixture.project.id, first.version.id, {
          testsVerdict: 'REJECT',
        }),
        { moduleVersionId: first.version.id, commitSha: first.version.commitSha },
      )
      const decision = new JuryDecisionService(fixture.store, { maxReworkCycles: 2 }).apply({
        projectId: fixture.project.id,
        taskId: first.task.id,
        moduleVersionId: first.version.id,
        juryRunId: first.juryRunId,
        consolidation: verdict,
      })
      expect(decision.verdict).toBe('REWORK_REQUIRED')
      const rework = decision.reworkTaskId
        ? fixture.store.getTask(decision.reworkTaskId as never)
        : undefined
      expect(rework?.moduleId).toBe(first.module.id)
      expect(rework?.ownerAgentId).toBe(first.frontendId)
      expect(rework?.reviewCycle).toBe(1)
      expect(rework?.contractId).toBeDefined()
      expect(fixture.store.getTask(second.task.id)?.state).toBe('IN_REVIEW')
      expect(fixture.store.getModule(second.module.id)?.status).toBe('IN_REVIEW')
      expect(fixture.store.getModule(first.module.id)?.status).toBe('REWORK_REQUIRED')
    } finally {
      fixture.close()
    }
  })

  it('stops after the configured rework cycle limit', () => {
    const fixture = createCoreFixture('C:/jury-cycles')
    try {
      const plan = fixture.approveAndStart()
      const { module, version, frontendId, contract, juryRunId } = createModuleTaskVersion(
        fixture,
        plan,
        'cycles',
      )
      const task = fixture.store.createTask({
        projectId: fixture.project.id,
        planId: plan.id,
        moduleId: module.id,
        title: 'Cycle limit',
        description: 'cycle limit',
        ownerAgentId: frontendId as AgentId,
        state: 'IN_REVIEW',
        reviewCycle: 2,
      })
      fixture.store.setTaskContract(task.id, contract.id)
      const verdict = new JuryVerdictService().consolidate(
        fourReviews(fixture.project.id, version.id, { testsVerdict: 'REJECT' }),
        { moduleVersionId: version.id, commitSha: version.commitSha },
      )
      const decision = new JuryDecisionService(fixture.store, { maxReworkCycles: 2 }).apply({
        projectId: fixture.project.id,
        taskId: task.id,
        moduleVersionId: version.id,
        juryRunId,
        consolidation: verdict,
      })
      expect(decision.blocked).toBe(true)
      expect(decision.reworkTaskId).toBeUndefined()
      expect(fixture.store.getTask(task.id)?.state).toBe('BLOCKED')
    } finally {
      fixture.close()
    }
  })

  it('does not inherit approval when a later module version is created', () => {
    const fixture = createCoreFixture('C:/jury-invalidate')
    try {
      const plan = fixture.approveAndStart()
      const { module, task, version, juryRunId } = createModuleTaskVersion(
        fixture,
        plan,
        'invalidate',
      )
      const verdict = new JuryVerdictService().consolidate(
        fourReviews(fixture.project.id, version.id),
        { moduleVersionId: version.id, commitSha: version.commitSha },
      )
      new JuryDecisionService(fixture.store, { maxReworkCycles: 2 }).apply({
        projectId: fixture.project.id,
        taskId: task.id,
        moduleVersionId: version.id,
        juryRunId,
        consolidation: verdict,
      })
      const frontend = fixture.tokens.verify(fixture.tokenFor('frontend'))
      const later = fixture.service.createModuleVersion(frontend, {
        moduleId: module.id,
        commitSha: 'b'.repeat(40),
        treeHash: 'tree-later',
        artifactHash: 'artifact-later',
      })
      expect(fixture.store.getModule(module.id)?.currentVersionId).toBe(later.id)
      expect(fixture.store.getApprovedModuleByVersion(later.id)).toBeUndefined()
      expect(fixture.store.getApprovedModuleByVersion(version.id)).toBeDefined()
      expect(fixture.store.getModuleVersion(later.id)?.status).toBe('IN_REVIEW')
    } finally {
      fixture.close()
    }
  })

  it('gives read-only judge sessions no edit or shell permissions', async () => {
    const fixture = createCoreFixture('C:/jury-readonly')
    try {
      const adapter = new MockOpenCodeAdapter()
      const sessions = new SessionManager(fixture.store, adapter)
      const testing = fixture.agentByCode.get('testing')!
      await sessions.createReadOnlySession({
        projectId: fixture.project.id,
        agent: testing,
        directory: process.cwd(),
        title: 'Read only',
      })
      const call = adapter.calls.find((item) => item.method === 'createSession')
      const input = call?.input as { permissions?: Array<{ action: string; effect: string }> }
      expect(
        input.permissions?.some((rule) => rule.action === 'edit' && rule.effect === 'deny'),
      ).toBe(true)
      expect(
        input.permissions?.some((rule) => rule.action === 'shell' && rule.effect === 'deny'),
      ).toBe(true)
    } finally {
      fixture.close()
    }
  })
})

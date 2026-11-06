import { afterEach, describe, expect, it } from 'vitest'
import { AuthorizationService } from '../../src/auth/authorization.js'
import type { Principal } from '../../src/auth/types.js'
import type { FeedbackReport, IntegrationRequest } from '../../src/integration/index.js'
import {
  DeliveryService,
  FeedbackService,
  GitIntegrationWorkspace,
  IntegrationManager,
  type AdapterAuthor,
} from '../../src/integration/index.js'
import type { WorktreeManager } from '../../src/worktrees/manager.js'
import {
  addNewUnapprovedVersion,
  approvedIntegrationRequest,
  createPhase5Fixture,
  failingFeedbackReport,
  frontendSumAdapter,
  git,
  passingFeedbackReport,
  type Phase5Fixture,
} from '../helpers/phase5.js'

const fixtures: Phase5Fixture[] = []

function fixture(): Phase5Fixture {
  const created = createPhase5Fixture()
  fixtures.push(created)
  return created
}

afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()!.close()
})

function authz(fixtureValue: Phase5Fixture): AuthorizationService {
  return new AuthorizationService(fixtureValue.core.store)
}

function integrator(fixtureValue: Phase5Fixture): Principal {
  return fixtureValue.core.principalFor('integrador')
}

function manager(fixtureValue: Phase5Fixture, adapterAuthor?: AdapterAuthor): IntegrationManager {
  return new IntegrationManager(
    fixtureValue.core.store,
    authz(fixtureValue),
    new GitIntegrationWorkspace(fixtureValue.worktrees, 20_000),
    {
      baseRef: fixtureValue.baseCommit,
      testsTimeoutMs: 20_000,
      worktreeRoot: fixtureValue.worktreeRoot,
    },
    adapterAuthor,
  )
}

function request(
  fixtureValue: Phase5Fixture,
  options: Parameters<typeof approvedIntegrationRequest>[1] = {},
): IntegrationRequest {
  return approvedIntegrationRequest(fixtureValue, {
    interfaceMappings: true,
    adapter: true,
    baseRef: fixtureValue.baseCommit,
    ...options,
  }) as unknown as IntegrationRequest
}

async function successfulIntegration(fixtureValue: Phase5Fixture) {
  const result = await manager(fixtureValue).run(integrator(fixtureValue), request(fixtureValue))
  expect(result.status).toBe('SUCCEEDED')
  expect(result.manifest).toBeDefined()
  return result
}

function feedbackService(
  fixtureValue: Phase5Fixture,
  report: Record<string, unknown>,
  reworkWorktrees?: WorktreeManager,
): FeedbackService {
  return new FeedbackService(
    fixtureValue.core.store,
    authz(fixtureValue),
    reworkWorktrees ?? fixtureValue.worktrees,
    {
      async run() {
        return report as unknown as FeedbackReport
      },
    },
  )
}

describe('Phase 5 integration and global feedback', () => {
  it('1. only integrates approved immutable versions', async () => {
    const f = fixture()
    const database = f.modules.get('database')!
    const result = await manager(f).run(
      integrator(f),
      request(f, {
        modules: ['frontend', 'database'],
        requiredModules: ['frontend', 'database'],
      }),
    )
    expect(result.status).toBe('STRUCTURAL_FAILED')
    expect(result.manifest).toBeUndefined()
    expect(result.conflicts.some((conflict) => conflict.code === 'MODULE_NOT_APPROVED')).toBe(true)
    expect(result.modules.some((module) => module.moduleId === database.module.id)).toBe(false)
    expect(f.core.store.getModuleVersion(database.version.id)?.status).toBe('IN_REVIEW')
    expect(f.core.store.listIntegrationManifests(f.project.id)).toHaveLength(0)
  })

  it('2. resolves a minor incompatibility with a tested adapter', async () => {
    const f = fixture()
    const author: AdapterAuthor = {
      async propose(input) {
        const adapter = frontendSumAdapter()
        adapter.moduleId = input.module.id
        return adapter
      },
    }
    const result = await manager(f, author).run(
      integrator(f),
      request(f, {
        adapter: false,
      }),
    )
    expect(result.status).toBe('SUCCEEDED')
    expect(result.manifest).toBeDefined()
    expect(result.adapters).toHaveLength(1)
    expect(result.adapters[0]?.status).toBe('VALIDATED')
    expect(result.adapters[0]?.version).toBe(1)
    expect(result.conflicts.some((conflict) => conflict.code === 'INTERFACE_NAME_MISMATCH')).toBe(
      true,
    )
    const manifest = result.manifest!.manifest
    const adapters = manifest['adapters'] as Array<{
      tests: Array<{ passed: boolean }>
      review: { status: string }
    }>
    expect(adapters).toHaveLength(1)
    expect(adapters[0]?.tests.every((test) => test.passed)).toBe(true)
    expect(adapters[0]?.review.status).toBe('VALIDATED')
  })

  it('3. records versions, commits and reviews of all artifacts', async () => {
    const f = fixture()
    const frontend = f.modules.get('frontend')!
    const result = await successfulIntegration(f)
    expect(f.core.store.getModuleVersion(frontend.version.id)).toBeDefined()
    expect(f.core.store.listReviewsForVersion(frontend.version.id)).toHaveLength(4)
    expect(f.core.store.getApprovedModuleByVersion(frontend.version.id)).toBeDefined()
    expect(result.adapters[0]?.commitSha).toBe(result.manifest!.manifest['integrationCommit'])
    expect(result.run.status).toBe('SUCCEEDED')
    expect(result.modules).toHaveLength(2)
  })

  it('4. returns structural problems to the coordinator without a manifest', async () => {
    const f = fixture()
    const result = await manager(f).run(
      integrator(f),
      request(f, {
        requiredModules: ['frontend', 'backend', 'database'],
      }),
    )
    expect(result.status).toBe('STRUCTURAL_FAILED')
    expect(result.manifest).toBeUndefined()
    expect(result.conflicts.some((conflict) => conflict.code === 'MISSING_REQUIRED_MODULE')).toBe(
      true,
    )
    const coordinator = f.core.agentByCode.get('coordinador')!
    const messages = f.core.store.listMessages(f.project.id, coordinator.id)
    expect(
      messages.some((message) => message.correlationId === `integration:${result.run.id}`),
    ).toBe(true)
    expect(f.core.store.getProject(f.project.id)?.status).toBe('RUNNING')
    expect(f.core.store.getModule(f.modules.get('frontend')!.module.id)?.status).toBe('APPROVED')
  })

  it('5. does not allow adapters to modify approved modules', async () => {
    const f = fixture()
    const adapter = frontendSumAdapter()
    adapter.moduleId = f.modules.get('frontend')!.module.id
    const invalid = {
      ...adapter,
      files: {
        ...adapter.files,
        'modules/frontend/hack.mjs': 'export const hack = true\n',
      },
    }
    const before = git(f.repoRoot, [
      'rev-parse',
      `${f.modules.get('frontend')!.commitSha}:modules/frontend`,
    ])
    const result = await manager(f).run(
      integrator(f),
      request(f, {
        adapters: [invalid],
      }),
    )
    expect(result.status).toBe('STRUCTURAL_FAILED')
    expect(result.manifest).toBeUndefined()
    expect(
      result.conflicts.some((conflict) =>
        ['ADAPTER_PATH_NOT_ALLOWED', 'ADAPTER_OVERLAPS_MODULE'].includes(conflict.code),
      ),
    ).toBe(true)
    const after = git(f.repoRoot, [
      'rev-parse',
      `${f.modules.get('frontend')!.commitSha}:modules/frontend`,
    ])
    expect(after).toBe(before)
    expect(f.core.store.listIntegrationManifests(f.project.id)).toHaveLength(0)
  })

  it('6. does not inherit approval after a module changes', async () => {
    const f = fixture()
    addNewUnapprovedVersion(f, 'frontend')
    const result = await manager(f).run(integrator(f), request(f))
    expect(result.status).toBe('STRUCTURAL_FAILED')
    expect(result.manifest).toBeUndefined()
    expect(result.conflicts.some((conflict) => conflict.code === 'STALE_MODULE_VERSION')).toBe(true)
  })

  it('7. returns only affected work after a global feedback failure', async () => {
    const f = fixture()
    const integrated = await successfulIntegration(f)
    const service = feedbackService(f, failingFeedbackReport(f))
    const result = await service.run(f.core.principalFor('feedback'), integrated.manifest!.id)
    expect(result.feedback.verdict).toBe('FAIL')
    expect(result.delivery).toBeUndefined()
    expect(result.affectedModules).toEqual([f.modules.get('frontend')!.module.id])
    expect(result.reworkTaskIds).toHaveLength(1)
    const tasks = f.core.store.listTasks(f.project.id)
    const rework = tasks.find((task) => task.id === result.reworkTaskIds[0])!
    expect(rework.moduleId).toBe(f.modules.get('frontend')!.module.id)
    const backendTask = f.core.store.getTask(f.modules.get('backend')!.task.id)!
    expect(backendTask.state).toBe('INTEGRATED')
    expect(f.core.store.listFinalDeliveries(f.project.id)).toHaveLength(0)
    expect(f.core.store.getProject(f.project.id)?.status).toBe('RUNNING')
  })

  it('8. cannot approve an unmet criterion without evidence', async () => {
    const f = fixture()
    const integrated = await successfulIntegration(f)
    const report = passingFeedbackReport(f)
    ;(report['criteria'] as Array<Record<string, unknown>>)[0]!['evidence'] = []
    const service = feedbackService(f, report)
    const result = await service.run(f.core.principalFor('feedback'), integrated.manifest!.id)
    expect(result.feedback.verdict).toBe('FAIL')
    expect(result.delivery).toBeUndefined()
    const checks = result.feedback.report['checks'] as Array<{ code: string; passed: boolean }>
    expect(checks.find((check) => check.code === 'feedback.criteria.evidence')?.passed).toBe(false)
  })

  it('9. final delivery requires global approval and human finalization', async () => {
    const f = fixture()
    const integrated = await successfulIntegration(f)
    const service = feedbackService(f, passingFeedbackReport(f))
    const result = await service.run(f.core.principalFor('feedback'), integrated.manifest!.id)
    expect(result.feedback.verdict).toBe('PASS')
    expect(result.delivery?.status).toBe('READY')
    expect(f.core.store.getProject(f.project.id)?.status).toBe('FEEDBACK')
    const deliveryService = new DeliveryService(f.core.store, authz(f))
    expect(() => deliveryService.finalize(integrator(f), result.delivery!.id)).toThrow()
    const finalized = deliveryService.finalize(
      f.core.tokens.verify(f.core.human),
      result.delivery!.id,
    )
    expect(finalized.status).toBe('DELIVERED')
    expect(f.core.store.getProject(f.project.id)?.status).toBe('COMPLETED')
    expect(
      f.core.store
        .listApprovals(f.project.id)
        .some(
          (approval) => approval.subjectType === 'DELIVERY' && approval.decision === 'APPROVED',
        ),
    ).toBe(true)
  })

  it('10. reuses the same manifest for the same immutable input', async () => {
    const f = fixture()
    const first = await successfulIntegration(f)
    const second = await manager(f).run(integrator(f), request(f))
    expect(second.reused).toBe(true)
    expect(second.manifest?.hash).toBe(first.manifest?.hash)
    expect(second.manifest?.manifest['integrationCommit']).toBe(
      first.manifest?.manifest['integrationCommit'],
    )
    expect(f.core.store.listIntegrationManifests(f.project.id)).toHaveLength(1)
    expect(f.core.store.listIntegrationRuns(f.project.id)).toHaveLength(1)
  })
})

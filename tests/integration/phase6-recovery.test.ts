import { afterEach, describe, expect, it } from 'vitest'
import { AuthorizationService } from '../../src/auth/authorization.js'
import { GitIntegrationWorkspace, IntegrationManager } from '../../src/integration/index.js'
import { RecoveryManager } from '../../src/recovery/manager.js'
import { WorktreeManager } from '../../src/worktrees/manager.js'
import {
  approvedIntegrationRequest,
  createPhase5Fixture,
  git,
  type Phase5Fixture,
} from '../helpers/phase5.js'

const fixtures: Phase5Fixture[] = []

afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()!.close()
})

describe('Phase 6 recovery over an approved integrated project', () => {
  it('preserves approved modules, manifest and integration commits across recovery', async () => {
    const fixture = createPhase5Fixture()
    fixtures.push(fixture)
    const authz = new AuthorizationService(fixture.core.store)
    const integration = new IntegrationManager(
      fixture.core.store,
      authz,
      new GitIntegrationWorkspace(fixture.worktrees, 20_000),
      {
        baseRef: fixture.baseCommit,
        testsTimeoutMs: 20_000,
        worktreeRoot: fixture.worktreeRoot,
      },
    )
    const request = approvedIntegrationRequest(fixture, {
      interfaceMappings: true,
      adapter: true,
      baseRef: fixture.baseCommit,
    })
    const integrated = await integration.run(
      fixture.core.principalFor('integrador'),
      request as never,
    )
    expect(integrated.status).toBe('SUCCEEDED')
    const approvedBefore = fixture.core.store.listApprovedModules(fixture.project.id)
    const manifestBefore = fixture.core.store.listIntegrationManifests(fixture.project.id)
    const runsBefore = fixture.core.store.listIntegrationRuns(fixture.project.id)
    const commitsBefore = git(fixture.repoRoot, ['rev-list', '--all'])

    const recovery = new RecoveryManager(
      fixture.core.store,
      authz,
      new WorktreeManager(fixture.repoRoot, fixture.worktreeRoot),
      {
        staleMinutes: 1,
        taskMaxAttempts: 3,
        leaseSeconds: 60,
        operationLeaseSeconds: 60,
      },
    )
    const result = await recovery.run(
      fixture.core.tokens.verify(fixture.core.human),
      fixture.project.id,
      { apply: true },
    )
    expect(result.run.status).toBe('COMPLETED')
    expect(fixture.core.store.listApprovedModules(fixture.project.id)).toEqual(approvedBefore)
    expect(fixture.core.store.listIntegrationManifests(fixture.project.id)).toEqual(manifestBefore)
    expect(fixture.core.store.listIntegrationRuns(fixture.project.id)).toEqual(runsBefore)
    expect(git(fixture.repoRoot, ['rev-list', '--all'])).toBe(commitsBefore)
    expect(
      approvedBefore.every(
        (approved) => fixture.core.store.getModule(approved.moduleId)?.status === 'INTEGRATED',
      ),
    ).toBe(true)
  })
})

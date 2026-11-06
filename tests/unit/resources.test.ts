import { describe, expect, it } from 'vitest'
import { createCoreFixture } from '../helpers/phase2.js'
import { ResourceGovernor, ResourceLimitError } from '../../src/resources/governor.js'

describe('resource governor', () => {
  it('estimates usage and pauses a project when a budget is exceeded', () => {
    const fixture = createCoreFixture('C:/resources')
    try {
      fixture.approveAndStart()
      const governor = new ResourceGovernor(fixture.store, {
        maxProjectTokens: 10,
        maxProjectCostUsd: 100,
        maxProjectMinutes: 60,
        inputCostPerMillion: 1,
        outputCostPerMillion: 2,
      })
      expect(governor.estimateTokens('12345678')).toBe(2)
      governor.recordUsage(fixture.project.id, 6, 6)
      const snapshot = governor.snapshot(fixture.project.id)
      expect(snapshot.totalTokens).toBe(12)
      expect(snapshot.exceeded).toContain('max_project_tokens')
      expect(() => governor.assertAvailable(fixture.project.id)).toThrow(ResourceLimitError)
      expect(fixture.store.getProject(fixture.project.id)?.status).toBe('PAUSED')
      expect(
        fixture.store
          .listEvents(fixture.project.id, 10)
          .some((event) => event.type === 'resource.limit_reached'),
      ).toBe(true)
    } finally {
      fixture.close()
    }
  })

  it('pauses when the total project time exceeds the configured limit', () => {
    const fixture = createCoreFixture('C:/resources-time')
    try {
      fixture.approveAndStart()
      fixture.store.ensureProjectResource(fixture.project.id, '2020-01-01T00:00:00.000Z')
      const governor = new ResourceGovernor(fixture.store, {
        maxProjectTokens: 1_000_000,
        maxProjectCostUsd: 100,
        maxProjectMinutes: 1,
        inputCostPerMillion: 1,
        outputCostPerMillion: 2,
      })
      expect(() => governor.assertAvailable(fixture.project.id)).toThrow(ResourceLimitError)
      expect(fixture.store.getProject(fixture.project.id)?.status).toBe('PAUSED')
    } finally {
      fixture.close()
    }
  })
})

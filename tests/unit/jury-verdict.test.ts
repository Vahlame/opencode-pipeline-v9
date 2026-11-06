import { describe, expect, it } from 'vitest'
import type { Finding, Review } from '../../src/domain/index.js'
import type { ModuleVersionId, ProjectId } from '../../src/domain/ids.js'
import { JuryVerdictService } from '../../src/jury/verdict.js'

const projectId = 'prj_jury' as ProjectId
const moduleVersionId = 'mdv_jury' as ModuleVersionId
const commitSha = 'a'.repeat(40)

function review(
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
    evidence: options.evidence ?? ['review evidence'],
    hash: `hash-${judgeRole}`,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function finding(severity: Finding['severity'], overrides: Partial<Finding> = {}): Finding {
  return {
    id: `finding-${severity}`,
    severity,
    message: `${severity} finding`,
    evidence: ['evidence'],
    ...overrides,
  }
}

describe('JuryVerdictService', () => {
  const service = new JuryVerdictService()

  it('requires all four judges and the three mandatory approvals', () => {
    const mandatory = [review('JUDGE_TESTS'), review('JUDGE_DEBUG'), review('JUDGE_ARCHITECTURE')]
    const incomplete = service.consolidate(mandatory, { moduleVersionId, commitSha })
    expect(incomplete.verdict).toBe('INCOMPLETE')
    expect(incomplete.missingRoles).toContain('JUDGE_OPTIMIZATION')

    const all = [...mandatory, review('JUDGE_OPTIMIZATION')]
    expect(service.consolidate(all, { moduleVersionId, commitSha }).verdict).toBe('APPROVED')
  })

  it('does not treat a missing or rejecting mandatory judge as approval', () => {
    const missing = service.consolidate(
      [review('JUDGE_TESTS'), review('JUDGE_DEBUG'), review('JUDGE_OPTIMIZATION')],
      { moduleVersionId, commitSha },
    )
    expect(missing.verdict).toBe('INCOMPLETE')
    expect(missing.missingRoles).toContain('JUDGE_ARCHITECTURE')

    const rejected = service.consolidate(
      [
        review('JUDGE_TESTS', { verdict: 'REJECT' }),
        review('JUDGE_DEBUG'),
        review('JUDGE_ARCHITECTURE'),
        review('JUDGE_OPTIMIZATION'),
      ],
      { moduleVersionId, commitSha },
    )
    expect(rejected.verdict).toBe('REWORK_REQUIRED')
  })

  it('does not approve a mandatory review with no evidence', () => {
    const result = service.consolidate(
      [
        review('JUDGE_TESTS', { evidence: [] }),
        review('JUDGE_DEBUG'),
        review('JUDGE_ARCHITECTURE'),
        review('JUDGE_OPTIMIZATION'),
      ],
      { moduleVersionId, commitSha },
    )
    expect(result.verdict).toBe('REWORK_REQUIRED')
    expect(result.blocking.some((item) => item.reason === 'MISSING_EVIDENCE')).toBe(true)
  })

  it('does not block on a minor optimization finding', () => {
    const result = service.consolidate(
      [
        review('JUDGE_TESTS'),
        review('JUDGE_DEBUG'),
        review('JUDGE_ARCHITECTURE'),
        review('JUDGE_OPTIMIZATION', { findings: [finding('MINOR')] }),
      ],
      { moduleVersionId, commitSha },
    )
    expect(result.verdict).toBe('APPROVED')
    expect(result.recommendations).toHaveLength(1)
  })

  it('blocks on a demonstrable critical optimization finding but not on an unsupported one', () => {
    const critical = finding('CRITICAL', {
      category: 'performance',
      evidence: ['benchmark: 10x over contract limit'],
      criterion: 'maxDurationMinutes',
    })
    const blocked = service.consolidate(
      [
        review('JUDGE_TESTS'),
        review('JUDGE_DEBUG'),
        review('JUDGE_ARCHITECTURE'),
        review('JUDGE_OPTIMIZATION', { findings: [critical] }),
      ],
      { moduleVersionId, commitSha },
    )
    expect(blocked.verdict).toBe('REWORK_REQUIRED')

    const unsupported = service.consolidate(
      [
        review('JUDGE_TESTS'),
        review('JUDGE_DEBUG'),
        review('JUDGE_ARCHITECTURE'),
        review('JUDGE_OPTIMIZATION', {
          findings: [finding('CRITICAL', { category: 'performance', evidence: [] })],
        }),
      ],
      { moduleVersionId, commitSha },
    )
    expect(unsupported.verdict).toBe('APPROVED')
  })
})

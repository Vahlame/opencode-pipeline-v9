import { z } from 'zod'
import type { Finding, Review } from '../domain/index.js'
import type { AgentRole } from '../domain/enums.js'
import type { ModuleVersionId } from '../domain/ids.js'
import { sha256 } from '../security/hash.js'

export const REVIEW_ROLES = [
  'JUDGE_TESTS',
  'JUDGE_DEBUG',
  'JUDGE_ARCHITECTURE',
  'JUDGE_OPTIMIZATION',
] as const

export const MANDATORY_ROLES = ['JUDGE_TESTS', 'JUDGE_DEBUG', 'JUDGE_ARCHITECTURE'] as const

export const FindingReportSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(['INFO', 'MINOR', 'MAJOR', 'CRITICAL']),
  category: z
    .enum([
      'tests',
      'debug',
      'architecture',
      'performance',
      'memory',
      'resource',
      'security',
      'data-loss',
      'concurrency',
      'contract',
      'acceptance',
      'maintainability',
      'other',
    ])
    .optional(),
  message: z.string().min(1),
  criterion: z.string().optional(),
  evidence: z.array(z.string()).default([]),
})
export type FindingReport = z.infer<typeof FindingReportSchema>

export const JudgeReportSchema = z.object({
  judgeRole: z.enum(REVIEW_ROLES),
  moduleVersionId: z.string().min(1),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/i),
  verdict: z.enum(['APPROVE', 'REJECT']),
  findings: z.array(FindingReportSchema).default([]),
  evidence: z.array(z.string()).default([]),
  summary: z.string().min(1),
})
export type JudgeReport = z.infer<typeof JudgeReportSchema>

export type ConsolidationVerdict = 'APPROVED' | 'REWORK_REQUIRED' | 'INCOMPLETE'

export interface BlockingFinding {
  readonly judgeRole: AgentRole
  readonly finding: Finding
  readonly reason: string
}

export interface JuryConsolidation {
  readonly verdict: ConsolidationVerdict
  readonly blocking: readonly BlockingFinding[]
  readonly recommendations: readonly BlockingFinding[]
  readonly missingRoles: readonly AgentRole[]
  readonly hash: string
}

const MANDATORY_BLOCKING_SEVERITIES = new Set(['MAJOR', 'CRITICAL'])
const OPTIMIZATION_CRITICAL_CATEGORIES = new Set([
  'performance',
  'memory',
  'resource',
  'security',
  'data-loss',
  'concurrency',
  'acceptance',
  'contract',
])

/**
 * Consolidación determinista. No llama a un modelo: recibe los dictámenes
 * persistidos y aplica reglas verificables.
 */
export class JuryVerdictService {
  consolidate(
    reviews: readonly Review[],
    expected: { moduleVersionId: ModuleVersionId; commitSha: string },
  ): JuryConsolidation {
    const byRole = new Map<AgentRole, Review>()
    for (const review of reviews) byRole.set(review.judgeRole, review)

    const missingRoles = REVIEW_ROLES.filter((role) => !byRole.has(role)) as AgentRole[]
    const blocking: BlockingFinding[] = []
    const recommendations: BlockingFinding[] = []

    for (const role of MANDATORY_ROLES) {
      const review = byRole.get(role)
      if (!review) {
        continue
      }
      if (review.moduleVersionId !== expected.moduleVersionId) {
        blocking.push({
          judgeRole: role,
          finding: syntheticFinding(
            'wrong-version',
            'MAJOR',
            'Review targets another module version',
          ),
          reason: 'WRONG_MODULE_VERSION',
        })
        continue
      }
      if (review.verdict !== 'APPROVE') {
        blocking.push({
          judgeRole: role,
          finding: syntheticFinding('rejected', 'MAJOR', 'Mandatory judge rejected the module'),
          reason: 'MANDATORY_REJECTED',
        })
      }
      if (review.evidence.length === 0) {
        blocking.push({
          judgeRole: role,
          finding: syntheticFinding('no-evidence', 'MAJOR', 'Mandatory review has no evidence'),
          reason: 'MISSING_EVIDENCE',
        })
      }
      for (const finding of review.findings) {
        if (MANDATORY_BLOCKING_SEVERITIES.has(finding.severity)) {
          blocking.push({ judgeRole: role, finding, reason: 'MANDATORY_BLOCKING_FINDING' })
        } else {
          recommendations.push({ judgeRole: role, finding, reason: 'ADVISORY' })
        }
      }
    }

    const optimization = byRole.get('JUDGE_OPTIMIZATION')
    if (optimization) {
      if (optimization.moduleVersionId !== expected.moduleVersionId) {
        blocking.push({
          judgeRole: 'JUDGE_OPTIMIZATION',
          finding: syntheticFinding(
            'wrong-version-opt',
            'MAJOR',
            'Optimization review targets another version',
          ),
          reason: 'WRONG_MODULE_VERSION',
        })
      }
      for (const finding of optimization.findings) {
        const critical =
          finding.severity === 'CRITICAL' &&
          finding.evidence.length > 0 &&
          (finding.category === undefined || OPTIMIZATION_CRITICAL_CATEGORIES.has(finding.category))
        if (critical) {
          blocking.push({
            judgeRole: 'JUDGE_OPTIMIZATION',
            finding,
            reason: 'OPTIMIZATION_CRITICAL',
          })
        } else {
          recommendations.push({
            judgeRole: 'JUDGE_OPTIMIZATION',
            finding,
            reason:
              finding.severity === 'CRITICAL'
                ? 'CRITICAL_NOT_DEMONSTRABLE'
                : 'OPTIMIZATION_ADVISORY',
          })
        }
      }
    }

    const verdict: ConsolidationVerdict =
      missingRoles.length > 0 ? 'INCOMPLETE' : blocking.length > 0 ? 'REWORK_REQUIRED' : 'APPROVED'

    return {
      verdict,
      blocking,
      recommendations,
      missingRoles,
      hash: sha256({
        moduleVersionId: expected.moduleVersionId,
        commitSha: expected.commitSha,
        reviews: reviews
          .map((review) => ({
            role: review.judgeRole,
            verdict: review.verdict,
            hash: review.hash,
            findings: review.findings,
            evidence: review.evidence,
          }))
          .sort((left, right) => left.role.localeCompare(right.role)),
        missingRoles,
        blocking,
        recommendations,
        verdict,
      }),
    }
  }
}

function syntheticFinding(id: string, severity: Finding['severity'], message: string): Finding {
  return { id, severity, message, evidence: [] }
}

export function isMandatoryRole(role: string): boolean {
  return (MANDATORY_ROLES as readonly string[]).includes(role)
}

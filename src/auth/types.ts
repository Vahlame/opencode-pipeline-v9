import { z } from 'zod'

export const PrincipalKindSchema = z.enum(['HUMAN', 'AGENT', 'SYSTEM'])
export type PrincipalKind = z.infer<typeof PrincipalKindSchema>

export const PrincipalRoleSchema = z.enum([
  'HUMAN',
  'SYSTEM',
  'PARENT',
  'COORDINATOR',
  'SPECIALIST',
  'JUDGE_TESTS',
  'JUDGE_DEBUG',
  'JUDGE_ARCHITECTURE',
  'JUDGE_OPTIMIZATION',
  'INTEGRATOR',
  'FEEDBACK',
])
export type PrincipalRole = z.infer<typeof PrincipalRoleSchema>

export const AGENT_ROLES = [
  'PARENT',
  'COORDINATOR',
  'SPECIALIST',
  'JUDGE_TESTS',
  'JUDGE_DEBUG',
  'JUDGE_ARCHITECTURE',
  'JUDGE_OPTIMIZATION',
  'INTEGRATOR',
  'FEEDBACK',
] as const

export const JUDGE_ROLES = [
  'JUDGE_TESTS',
  'JUDGE_DEBUG',
  'JUDGE_ARCHITECTURE',
  'JUDGE_OPTIMIZATION',
] as const

export const PrincipalSchema = z
  .object({
    subjectId: z.string().min(1),
    kind: PrincipalKindSchema,
    role: PrincipalRoleSchema,
    projectId: z.string().min(1).optional(),
    agentId: z.string().min(1).optional(),
  })
  .superRefine((principal, ctx) => {
    if (principal.kind === 'HUMAN' && principal.role !== 'HUMAN') {
      ctx.addIssue({ code: 'custom', message: 'HUMAN principals must use the HUMAN role' })
    }
    if (principal.kind === 'AGENT' && principal.role === 'HUMAN') {
      ctx.addIssue({ code: 'custom', message: 'AGENT principals cannot use the HUMAN role' })
    }
    if (principal.kind === 'AGENT' && !principal.agentId) {
      ctx.addIssue({ code: 'custom', message: 'AGENT principals require agentId' })
    }
    if (principal.kind === 'AGENT' && !principal.projectId) {
      ctx.addIssue({ code: 'custom', message: 'AGENT principals require projectId' })
    }
  })

export type Principal = z.infer<typeof PrincipalSchema>

export function isJudgeRole(role: PrincipalRole): boolean {
  return (JUDGE_ROLES as readonly string[]).includes(role)
}

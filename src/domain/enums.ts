import { z } from 'zod'

export const ProjectStatusSchema = z.enum([
  'DRAFT',
  'PLAN_PROPOSED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'RUNNING',
  'PAUSED',
  'INTEGRATING',
  'FEEDBACK',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
])
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>

export const PlanStatusSchema = z.enum(['DRAFT', 'PROPOSED', 'APPROVED', 'REJECTED', 'SUPERSEDED'])
export type PlanStatus = z.infer<typeof PlanStatusSchema>

export const AgentRoleSchema = z.enum([
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
export type AgentRole = z.infer<typeof AgentRoleSchema>

export const AgentStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'OFFLINE'])
export type AgentStatus = z.infer<typeof AgentStatusSchema>

export const TaskStateSchema = z.enum([
  'PENDING',
  'READY',
  'RUNNING',
  'IN_REVIEW',
  'REWORK_REQUIRED',
  'APPROVED',
  'INTEGRATED',
  'BLOCKED',
  'FAILED',
  'CANCELLED',
])
export type TaskState = z.infer<typeof TaskStateSchema>

export const ModuleStatusSchema = z.enum([
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'INTEGRATED',
  'REWORK_REQUIRED',
  'REJECTED',
])
export type ModuleStatus = z.infer<typeof ModuleStatusSchema>

export const MessageKindSchema = z.enum(['INFO', 'QUERY', 'ORDER', 'PAUSE', 'CANCEL'])
export type MessageKind = z.infer<typeof MessageKindSchema>

export const MessageStateSchema = z.enum(['QUEUED', 'DELIVERED', 'ACKED', 'REJECTED', 'EXPIRED'])
export type MessageState = z.infer<typeof MessageStateSchema>

export const ReviewVerdictSchema = z.enum(['APPROVE', 'REJECT'])
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>

export const ReviewSeveritySchema = z.enum(['INFO', 'MINOR', 'MAJOR', 'CRITICAL'])
export type ReviewSeverity = z.infer<typeof ReviewSeveritySchema>

export const ApprovalSubjectSchema = z.enum([
  'PLAN',
  'CONTRACT',
  'MODULE',
  'INTEGRATION',
  'DELIVERY',
])
export type ApprovalSubject = z.infer<typeof ApprovalSubjectSchema>

export const ApprovalDecisionSchema = z.enum(['APPROVED', 'REJECTED'])
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>

export const ContractStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'SUPERSEDED', 'REJECTED'])
export type ContractStatus = z.infer<typeof ContractStatusSchema>

export const DependencyKindSchema = z.enum(['REQUIRES', 'SOFT'])
export type DependencyKind = z.infer<typeof DependencyKindSchema>

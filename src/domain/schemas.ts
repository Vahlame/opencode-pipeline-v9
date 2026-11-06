import { z } from 'zod'
import {
  AgentIdSchema,
  ApprovalIdSchema,
  AuditIdSchema,
  CheckpointIdSchema,
  ContractIdSchema,
  EventIdSchema,
  MessageIdSchema,
  ModuleIdSchema,
  ModuleVersionIdSchema,
  PlanIdSchema,
  ProjectIdSchema,
  ReviewIdSchema,
  TaskIdSchema,
} from './ids.js'
import {
  AgentRoleSchema,
  AgentStatusSchema,
  ApprovalDecisionSchema,
  ApprovalSubjectSchema,
  ContractStatusSchema,
  DependencyKindSchema,
  MessageKindSchema,
  MessageStateSchema,
  ModuleStatusSchema,
  PlanStatusSchema,
  ProjectStatusSchema,
  ReviewSeveritySchema,
  ReviewVerdictSchema,
  TaskStateSchema,
} from './enums.js'

const TimestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Expected an ISO-8601 timestamp',
})
const JsonObjectSchema = z.record(z.string(), z.unknown())
const NonEmptyStringSchema = z.string().min(1)
const StringListSchema = z.array(NonEmptyStringSchema).default([])

export const ProjectSchema = z.object({
  id: ProjectIdSchema,
  name: NonEmptyStringSchema,
  repoPath: NonEmptyStringSchema,
  status: ProjectStatusSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  version: z.number().int().nonnegative(),
})
export type Project = z.infer<typeof ProjectSchema>

export const PlanSchema = z.object({
  id: PlanIdSchema,
  projectId: ProjectIdSchema,
  version: z.number().int().positive(),
  title: NonEmptyStringSchema,
  status: PlanStatusSchema,
  spec: JsonObjectSchema,
  plan: JsonObjectSchema,
  hash: NonEmptyStringSchema,
  proposedBy: AgentIdSchema,
  approvedBy: NonEmptyStringSchema.optional(),
  approvedAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Plan = z.infer<typeof PlanSchema>

export const AgentSchema = z.object({
  id: AgentIdSchema,
  projectId: ProjectIdSchema,
  role: AgentRoleSchema,
  name: NonEmptyStringSchema,
  opencodeAgentId: NonEmptyStringSchema,
  status: AgentStatusSchema,
  capabilities: StringListSchema,
  currentTaskId: TaskIdSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Agent = z.infer<typeof AgentSchema>

export const TaskSchema = z.object({
  id: TaskIdSchema,
  projectId: ProjectIdSchema,
  planId: PlanIdSchema,
  moduleId: ModuleIdSchema.optional(),
  title: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  state: TaskStateSchema,
  priority: z.number().int().min(0).max(100),
  ownerAgentId: AgentIdSchema.optional(),
  contractId: ContractIdSchema.optional(),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  reviewCycle: z.number().int().nonnegative().default(0),
  leaseExpiresAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  version: z.number().int().nonnegative(),
})
export type Task = z.infer<typeof TaskSchema>

export const TaskDependencySchema = z.object({
  taskId: TaskIdSchema,
  dependsOnTaskId: TaskIdSchema,
  kind: DependencyKindSchema.default('REQUIRES'),
})
export type TaskDependency = z.infer<typeof TaskDependencySchema>

export const ModuleSchema = z.object({
  id: ModuleIdSchema,
  projectId: ProjectIdSchema,
  name: NonEmptyStringSchema,
  ownerAgentId: AgentIdSchema,
  pathScope: z.array(NonEmptyStringSchema).min(1),
  status: ModuleStatusSchema,
  currentVersionId: ModuleVersionIdSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Module = z.infer<typeof ModuleSchema>

export const ModuleVersionSchema = z.object({
  id: ModuleVersionIdSchema,
  moduleId: ModuleIdSchema,
  version: z.number().int().positive(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/i),
  treeHash: NonEmptyStringSchema,
  artifactHash: NonEmptyStringSchema,
  status: ModuleStatusSchema,
  createdAt: TimestampSchema,
})
export type ModuleVersion = z.infer<typeof ModuleVersionSchema>

export const ContractSchema = z.object({
  id: ContractIdSchema,
  taskId: TaskIdSchema,
  moduleId: ModuleIdSchema,
  version: z.number().int().positive(),
  objective: NonEmptyStringSchema,
  allowedPaths: z.array(NonEmptyStringSchema).min(1),
  inputInterfaces: z.array(NonEmptyStringSchema),
  outputInterfaces: z.array(NonEmptyStringSchema),
  acceptanceTests: z.array(NonEmptyStringSchema),
  limits: z.object({
    maxDurationMinutes: z.number().positive(),
    maxTokens: z.number().int().positive().optional(),
    maxCostUsd: z.number().nonnegative().optional(),
  }),
  deliveryFormat: NonEmptyStringSchema,
  hash: NonEmptyStringSchema,
  status: ContractStatusSchema,
  createdAt: TimestampSchema,
})
export type Contract = z.infer<typeof ContractSchema>

export const EventSchema = z.object({
  id: EventIdSchema,
  seq: z.number().int().positive(),
  projectId: ProjectIdSchema,
  type: NonEmptyStringSchema,
  aggregateType: NonEmptyStringSchema,
  aggregateId: NonEmptyStringSchema,
  actorId: NonEmptyStringSchema.optional(),
  payload: JsonObjectSchema,
  traceId: NonEmptyStringSchema.optional(),
  createdAt: TimestampSchema,
})
export type Event = z.infer<typeof EventSchema>

export const MessageSchema = z.object({
  id: MessageIdSchema,
  projectId: ProjectIdSchema,
  fromAgentId: AgentIdSchema,
  toAgentId: AgentIdSchema,
  correlationId: NonEmptyStringSchema,
  kind: MessageKindSchema,
  priority: z.number().int().min(0).max(100),
  state: MessageStateSchema,
  payload: JsonObjectSchema,
  requiresApproval: z.boolean(),
  approvedBy: NonEmptyStringSchema.optional(),
  idempotencyKey: NonEmptyStringSchema,
  createdAt: TimestampSchema,
  deliveredAt: TimestampSchema.optional(),
  ackedAt: TimestampSchema.optional(),
})
export type Message = z.infer<typeof MessageSchema>

export const FindingSchema = z.object({
  id: NonEmptyStringSchema,
  severity: ReviewSeveritySchema,
  message: NonEmptyStringSchema,
  category: NonEmptyStringSchema.optional(),
  criterion: NonEmptyStringSchema.optional(),
  evidence: z.array(NonEmptyStringSchema).default([]),
})
export type Finding = z.infer<typeof FindingSchema>

export const ReviewSchema = z.object({
  id: ReviewIdSchema,
  projectId: ProjectIdSchema,
  moduleVersionId: ModuleVersionIdSchema,
  judgeRole: AgentRoleSchema,
  verdict: ReviewVerdictSchema,
  findings: z.array(FindingSchema),
  evidence: z.array(NonEmptyStringSchema),
  hash: NonEmptyStringSchema,
  createdAt: TimestampSchema,
})
export type Review = z.infer<typeof ReviewSchema>

export const ApprovalSchema = z.object({
  id: ApprovalIdSchema,
  projectId: ProjectIdSchema,
  subjectType: ApprovalSubjectSchema,
  subjectId: NonEmptyStringSchema,
  subjectHash: NonEmptyStringSchema,
  approverId: NonEmptyStringSchema,
  decision: ApprovalDecisionSchema,
  reason: z.string().optional(),
  createdAt: TimestampSchema,
})
export type Approval = z.infer<typeof ApprovalSchema>

export const CheckpointSchema = z.object({
  id: CheckpointIdSchema,
  projectId: ProjectIdSchema,
  scope: NonEmptyStringSchema,
  state: JsonObjectSchema,
  hash: NonEmptyStringSchema,
  createdAt: TimestampSchema,
})
export type Checkpoint = z.infer<typeof CheckpointSchema>

export const AuditEntrySchema = z.object({
  id: AuditIdSchema,
  projectId: ProjectIdSchema.optional(),
  actorId: NonEmptyStringSchema,
  action: NonEmptyStringSchema,
  resource: NonEmptyStringSchema,
  decision: z.enum(['ALLOW', 'DENY']),
  reason: NonEmptyStringSchema,
  requestId: NonEmptyStringSchema.optional(),
  createdAt: TimestampSchema,
})
export type AuditEntry = z.infer<typeof AuditEntrySchema>

export const LeaseSchema = z.object({
  taskId: TaskIdSchema,
  ownerId: NonEmptyStringSchema,
  attempt: z.number().int().positive(),
  expiresAt: TimestampSchema,
  heartbeatAt: TimestampSchema,
})
export type Lease = z.infer<typeof LeaseSchema>

export const DeliverySchema = z.object({
  id: NonEmptyStringSchema,
  taskId: TaskIdSchema,
  moduleVersionId: ModuleVersionIdSchema,
  commitSha: z.string().regex(/^[0-9a-f]{40}$/i),
  contentHash: NonEmptyStringSchema,
  testsPassed: z.boolean(),
  evidence: z.array(NonEmptyStringSchema),
  createdAt: TimestampSchema,
})
export type Delivery = z.infer<typeof DeliverySchema>

export const IntegrationRunSchema = z.object({
  id: NonEmptyStringSchema,
  projectId: ProjectIdSchema,
  planHash: NonEmptyStringSchema,
  moduleSetHash: NonEmptyStringSchema,
  status: z.enum(['RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED']),
  baseCommit: z.string().min(1),
  manifest: JsonObjectSchema,
  createdAt: TimestampSchema,
  completedAt: TimestampSchema.optional(),
})
export type IntegrationRun = z.infer<typeof IntegrationRunSchema>

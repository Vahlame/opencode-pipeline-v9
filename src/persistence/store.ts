import type {
  Agent,
  Approval,
  AuditEntry,
  Checkpoint,
  Contract,
  Event,
  Message,
  Module,
  ModuleVersion,
  Plan,
  Project,
  Review,
  Task,
  TaskDependency,
} from '../domain/index.js'
import type {
  AgentId,
  ApprovalId,
  AuditId,
  CheckpointId,
  ContractId,
  EventId,
  MessageId,
  ModuleId,
  ModuleVersionId,
  PlanId,
  ProjectId,
  ReviewId,
  TaskId,
} from '../domain/ids.js'
import { createId, nowIso } from '../domain/id-factory.js'
import { sha256 } from '../security/hash.js'
import { redact, redactText } from '../security/redaction.js'
import { SqliteDatabase } from './database.js'

type DbRow = Record<string, unknown>

function text(row: DbRow, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`Expected TEXT column ${key}`)
  return value
}

function optionalText(row: DbRow, key: string): string | undefined {
  const value = row[key]
  return typeof value === 'string' ? value : undefined
}

function integer(row: DbRow, key: string): number {
  const value = row[key]
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  throw new Error(`Expected INTEGER column ${key}`)
}

function json<T>(row: DbRow, key: string): T {
  const value = text(row, key)
  try {
    return JSON.parse(value) as T
  } catch {
    throw new Error(`Invalid JSON in column ${key}`)
  }
}

function toProject(row: DbRow): Project {
  return {
    id: text(row, 'id') as ProjectId,
    name: text(row, 'name'),
    repoPath: text(row, 'repo_path'),
    status: text(row, 'status') as Project['status'],
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    version: integer(row, 'version'),
  }
}

function toPlan(row: DbRow): Plan {
  return {
    id: text(row, 'id') as PlanId,
    projectId: text(row, 'project_id') as ProjectId,
    version: integer(row, 'version'),
    title: text(row, 'title'),
    status: text(row, 'status') as Plan['status'],
    spec: json(row, 'spec_json'),
    plan: json(row, 'plan_json'),
    hash: text(row, 'hash'),
    proposedBy: text(row, 'proposed_by') as AgentId,
    ...(optionalText(row, 'approved_by') ? { approvedBy: optionalText(row, 'approved_by') } : {}),
    ...(optionalText(row, 'approved_at') ? { approvedAt: optionalText(row, 'approved_at') } : {}),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  }
}

function toAgent(row: DbRow): Agent {
  return {
    id: text(row, 'id') as AgentId,
    projectId: text(row, 'project_id') as ProjectId,
    role: text(row, 'role') as Agent['role'],
    name: text(row, 'name'),
    opencodeAgentId: text(row, 'opencode_agent_id'),
    status: text(row, 'status') as Agent['status'],
    capabilities: json(row, 'capabilities_json'),
    ...(optionalText(row, 'current_task_id')
      ? { currentTaskId: optionalText(row, 'current_task_id') as TaskId }
      : {}),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  }
}

function toModule(row: DbRow): Module {
  return {
    id: text(row, 'id') as ModuleId,
    projectId: text(row, 'project_id') as ProjectId,
    name: text(row, 'name'),
    ownerAgentId: text(row, 'owner_agent_id') as AgentId,
    pathScope: json(row, 'path_scope_json'),
    status: text(row, 'status') as Module['status'],
    ...(optionalText(row, 'current_version_id')
      ? { currentVersionId: optionalText(row, 'current_version_id') as ModuleVersionId }
      : {}),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  }
}

function toTask(row: DbRow): Task {
  return {
    id: text(row, 'id') as TaskId,
    projectId: text(row, 'project_id') as ProjectId,
    planId: text(row, 'plan_id') as PlanId,
    ...(optionalText(row, 'module_id')
      ? { moduleId: optionalText(row, 'module_id') as ModuleId }
      : {}),
    title: text(row, 'title'),
    description: text(row, 'description'),
    state: text(row, 'state') as Task['state'],
    priority: integer(row, 'priority'),
    reviewCycle: integer(row, 'review_cycle'),
    ...(optionalText(row, 'owner_agent_id')
      ? { ownerAgentId: optionalText(row, 'owner_agent_id') as AgentId }
      : {}),
    ...(optionalText(row, 'contract_id')
      ? { contractId: optionalText(row, 'contract_id') as ContractId }
      : {}),
    attemptCount: integer(row, 'attempt_count'),
    maxAttempts: integer(row, 'max_attempts'),
    ...(optionalText(row, 'lease_expires_at')
      ? { leaseExpiresAt: optionalText(row, 'lease_expires_at') }
      : {}),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    version: integer(row, 'version'),
  }
}

function toTaskDependency(row: DbRow): TaskDependency {
  return {
    taskId: text(row, 'task_id') as TaskId,
    dependsOnTaskId: text(row, 'depends_on_task_id') as TaskId,
    kind: text(row, 'kind') as TaskDependency['kind'],
  }
}

function toContract(row: DbRow): Contract {
  return {
    id: text(row, 'id') as ContractId,
    taskId: text(row, 'task_id') as TaskId,
    moduleId: text(row, 'module_id') as ModuleId,
    version: integer(row, 'version'),
    objective: text(row, 'objective'),
    allowedPaths: json(row, 'allowed_paths_json'),
    inputInterfaces: json(row, 'input_interfaces_json'),
    outputInterfaces: json(row, 'output_interfaces_json'),
    acceptanceTests: json(row, 'acceptance_tests_json'),
    limits: json(row, 'limits_json'),
    deliveryFormat: text(row, 'delivery_format'),
    hash: text(row, 'hash'),
    status: text(row, 'status') as Contract['status'],
    createdAt: text(row, 'created_at'),
  }
}

function toModuleVersion(row: DbRow): ModuleVersion {
  return {
    id: text(row, 'id') as ModuleVersionId,
    moduleId: text(row, 'module_id') as ModuleId,
    version: integer(row, 'version'),
    commitSha: text(row, 'commit_sha'),
    treeHash: text(row, 'tree_hash'),
    artifactHash: text(row, 'artifact_hash'),
    status: text(row, 'status') as ModuleVersion['status'],
    createdAt: text(row, 'created_at'),
  }
}

function toMessage(row: DbRow): Message {
  return {
    id: text(row, 'id') as MessageId,
    projectId: text(row, 'project_id') as ProjectId,
    fromAgentId: text(row, 'from_agent_id') as AgentId,
    toAgentId: text(row, 'to_agent_id') as AgentId,
    correlationId: text(row, 'correlation_id'),
    kind: text(row, 'kind') as Message['kind'],
    priority: integer(row, 'priority'),
    state: text(row, 'state') as Message['state'],
    payload: json(row, 'payload_json'),
    requiresApproval: integer(row, 'requires_approval') === 1,
    ...(optionalText(row, 'approved_by') ? { approvedBy: optionalText(row, 'approved_by') } : {}),
    idempotencyKey: text(row, 'idempotency_key'),
    createdAt: text(row, 'created_at'),
    ...(optionalText(row, 'delivered_at')
      ? { deliveredAt: optionalText(row, 'delivered_at') }
      : {}),
    ...(optionalText(row, 'acked_at') ? { ackedAt: optionalText(row, 'acked_at') } : {}),
  }
}

function toReview(row: DbRow): Review {
  return {
    id: text(row, 'id') as ReviewId,
    projectId: text(row, 'project_id') as ProjectId,
    moduleVersionId: text(row, 'module_version_id') as ModuleVersionId,
    judgeRole: text(row, 'judge_role') as Review['judgeRole'],
    verdict: text(row, 'verdict') as Review['verdict'],
    findings: json(row, 'findings_json'),
    evidence: json(row, 'evidence_json'),
    hash: text(row, 'hash'),
    createdAt: text(row, 'created_at'),
  }
}

function toApproval(row: DbRow): Approval {
  return {
    id: text(row, 'id') as ApprovalId,
    projectId: text(row, 'project_id') as ProjectId,
    subjectType: text(row, 'subject_type') as Approval['subjectType'],
    subjectId: text(row, 'subject_id'),
    subjectHash: text(row, 'subject_hash'),
    approverId: text(row, 'approver_id'),
    decision: text(row, 'decision') as Approval['decision'],
    ...(optionalText(row, 'reason') ? { reason: optionalText(row, 'reason') } : {}),
    createdAt: text(row, 'created_at'),
  }
}

function toEvent(row: DbRow): Event {
  return {
    id: text(row, 'id') as EventId,
    seq: integer(row, 'seq'),
    projectId: text(row, 'project_id') as ProjectId,
    type: text(row, 'type'),
    aggregateType: text(row, 'aggregate_type'),
    aggregateId: text(row, 'aggregate_id'),
    ...(optionalText(row, 'actor_id') ? { actorId: optionalText(row, 'actor_id') } : {}),
    payload: json(row, 'payload_json'),
    ...(optionalText(row, 'trace_id') ? { traceId: optionalText(row, 'trace_id') } : {}),
    createdAt: text(row, 'created_at'),
  }
}

function toCheckpoint(row: DbRow): Checkpoint {
  return {
    id: text(row, 'id') as CheckpointId,
    projectId: text(row, 'project_id') as ProjectId,
    scope: text(row, 'scope'),
    state: json(row, 'state_json'),
    hash: text(row, 'hash'),
    createdAt: text(row, 'created_at'),
  }
}

function toSessionRecord(row: DbRow): SessionRecord {
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id') as ProjectId,
    agentId: text(row, 'agent_id') as AgentId,
    ...(optionalText(row, 'opencode_session_id')
      ? { opencodeSessionId: optionalText(row, 'opencode_session_id') }
      : {}),
    ...(optionalText(row, 'worktree_path')
      ? { worktreePath: optionalText(row, 'worktree_path') }
      : {}),
    status: text(row, 'status') as SessionRecord['status'],
    ...(optionalText(row, 'last_event_seq')
      ? { lastEventSeq: Number(optionalText(row, 'last_event_seq')) }
      : {}),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  }
}

function toLease(row: DbRow): LeaseRecord {
  return {
    taskId: text(row, 'task_id') as TaskId,
    ownerId: text(row, 'owner_id'),
    attempt: integer(row, 'attempt'),
    expiresAt: text(row, 'expires_at'),
    heartbeatAt: text(row, 'heartbeat_at'),
    createdAt: text(row, 'created_at'),
  }
}

function toWorktree(row: DbRow): WorktreeRecord {
  return {
    id: text(row, 'id'),
    taskId: text(row, 'task_id') as TaskId,
    ...(optionalText(row, 'module_id')
      ? { moduleId: optionalText(row, 'module_id') as ModuleId }
      : {}),
    path: text(row, 'path'),
    branch: text(row, 'branch'),
    baseCommit: text(row, 'base_commit'),
    status: text(row, 'status') as WorktreeRecord['status'],
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  }
}

function toTaskAttempt(row: DbRow): TaskAttemptRecord {
  return {
    id: text(row, 'id'),
    taskId: text(row, 'task_id') as TaskId,
    attempt: integer(row, 'attempt'),
    status: text(row, 'status') as TaskAttemptRecord['status'],
    ...(optionalText(row, 'session_id') ? { sessionId: optionalText(row, 'session_id') } : {}),
    startedAt: text(row, 'started_at'),
    ...(optionalText(row, 'ended_at') ? { endedAt: optionalText(row, 'ended_at') } : {}),
    ...(optionalText(row, 'error') ? { error: optionalText(row, 'error') } : {}),
  }
}

function toJuryRun(row: DbRow): JuryRunRecord {
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id') as ProjectId,
    taskId: text(row, 'task_id') as TaskId,
    moduleVersionId: text(row, 'module_version_id') as ModuleVersionId,
    status: text(row, 'status') as JuryRunRecord['status'],
    cycle: integer(row, 'cycle'),
    startedAt: text(row, 'started_at'),
    ...(optionalText(row, 'completed_at')
      ? { completedAt: optionalText(row, 'completed_at') }
      : {}),
    createdAt: text(row, 'created_at'),
  }
}

function toConsolidation(row: DbRow): ConsolidationRecord {
  return {
    id: text(row, 'id'),
    juryRunId: text(row, 'jury_run_id'),
    moduleVersionId: text(row, 'module_version_id') as ModuleVersionId,
    verdict: text(row, 'verdict') as ConsolidationRecord['verdict'],
    blocking: json(row, 'blocking_json'),
    recommendations: json(row, 'recommendations_json'),
    missingRoles: json(row, 'missing_roles_json'),
    hash: text(row, 'hash'),
    createdAt: text(row, 'created_at'),
  }
}

function toApprovedModule(row: DbRow): ApprovedModuleRecord {
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id') as ProjectId,
    moduleId: text(row, 'module_id') as ModuleId,
    moduleVersionId: text(row, 'module_version_id') as ModuleVersionId,
    commitSha: text(row, 'commit_sha'),
    artifactHash: text(row, 'artifact_hash'),
    approvedAt: text(row, 'approved_at'),
    juryRunId: text(row, 'jury_run_id'),
  }
}

function toIntegrationRun(row: DbRow): IntegrationRunRecord {
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id') as ProjectId,
    planId: text(row, 'plan_id') as PlanId,
    status: text(row, 'status') as IntegrationRunRecord['status'],
    attempt: integer(row, 'attempt'),
    baseCommit: text(row, 'base_commit'),
    integrationPath: text(row, 'integration_path'),
    inputHash: text(row, 'input_hash'),
    ...(optionalText(row, 'manifest_hash')
      ? { manifestHash: optionalText(row, 'manifest_hash') }
      : {}),
    ...(optionalText(row, 'error') ? { error: optionalText(row, 'error') } : {}),
    createdAt: text(row, 'created_at'),
    ...(optionalText(row, 'completed_at')
      ? { completedAt: optionalText(row, 'completed_at') }
      : {}),
  }
}

function toIntegrationModule(row: DbRow): IntegrationModuleRecord {
  return {
    id: text(row, 'id'),
    runId: text(row, 'run_id'),
    moduleId: text(row, 'module_id') as ModuleId,
    moduleVersionId: text(row, 'module_version_id') as ModuleVersionId,
    commitSha: text(row, 'commit_sha'),
    artifactHash: text(row, 'artifact_hash'),
    ...(optionalText(row, 'contract_id')
      ? { contractId: optionalText(row, 'contract_id') as ContractId }
      : {}),
    status: text(row, 'status') as IntegrationModuleRecord['status'],
    createdAt: text(row, 'created_at'),
  }
}

function toIntegrationAdapter(row: DbRow): IntegrationAdapterRecord {
  return {
    id: text(row, 'id'),
    runId: text(row, 'run_id'),
    moduleId: text(row, 'module_id') as ModuleId,
    path: text(row, 'path'),
    commitSha: text(row, 'commit_sha'),
    version: integer(row, 'version'),
    tests: json(row, 'tests_json'),
    review: json(row, 'review_json'),
    status: text(row, 'status') as IntegrationAdapterRecord['status'],
    createdAt: text(row, 'created_at'),
  }
}

function toIntegrationConflict(row: DbRow): IntegrationConflictRecord {
  return {
    id: text(row, 'id'),
    runId: text(row, 'run_id'),
    type: text(row, 'type') as IntegrationConflictRecord['type'],
    code: text(row, 'code'),
    message: text(row, 'message'),
    modules: json(row, 'modules_json'),
    evidence: json(row, 'evidence_json'),
    ...(optionalText(row, 'resolution') ? { resolution: optionalText(row, 'resolution') } : {}),
    createdAt: text(row, 'created_at'),
  }
}

function toIntegrationManifest(row: DbRow): IntegrationManifestRecord {
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id') as ProjectId,
    planId: text(row, 'plan_id') as PlanId,
    runId: text(row, 'run_id'),
    hash: text(row, 'hash'),
    baseCommit: text(row, 'base_commit'),
    manifest: json(row, 'manifest_json'),
    createdAt: text(row, 'created_at'),
  }
}

function toFeedbackRun(row: DbRow): FeedbackRunRecord {
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id') as ProjectId,
    planId: text(row, 'plan_id') as PlanId,
    manifestId: text(row, 'manifest_id'),
    status: text(row, 'status') as FeedbackRunRecord['status'],
    ...(optionalText(row, 'verdict')
      ? { verdict: optionalText(row, 'verdict') as FeedbackRunRecord['verdict'] }
      : {}),
    report: json(row, 'report_json'),
    hash: text(row, 'hash'),
    createdAt: text(row, 'created_at'),
    ...(optionalText(row, 'completed_at')
      ? { completedAt: optionalText(row, 'completed_at') }
      : {}),
  }
}

function toFinalDelivery(row: DbRow): FinalDeliveryRecord {
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id') as ProjectId,
    manifestId: text(row, 'manifest_id'),
    feedbackId: text(row, 'feedback_id'),
    status: text(row, 'status') as FinalDeliveryRecord['status'],
    summary: json(row, 'summary_json'),
    createdAt: text(row, 'created_at'),
    ...(optionalText(row, 'delivered_at')
      ? { deliveredAt: optionalText(row, 'delivered_at') }
      : {}),
  }
}

function toAuditEntry(row: DbRow): AuditEntry {
  return {
    id: text(row, 'id') as AuditId,
    ...(optionalText(row, 'project_id')
      ? { projectId: optionalText(row, 'project_id') as ProjectId }
      : {}),
    actorId: text(row, 'actor_id'),
    action: text(row, 'action'),
    resource: text(row, 'resource'),
    decision: text(row, 'decision') as AuditEntry['decision'],
    reason: text(row, 'reason'),
    ...(optionalText(row, 'request_id') ? { requestId: optionalText(row, 'request_id') } : {}),
    createdAt: text(row, 'created_at'),
  }
}

export interface CreateProjectRecord {
  readonly name: string
  readonly repoPath: string
  readonly status?: Project['status']
}

export interface CreatePlanRecord {
  readonly projectId: ProjectId
  readonly version: number
  readonly title: string
  readonly status?: Plan['status']
  readonly spec: Record<string, unknown>
  readonly plan: Record<string, unknown>
  readonly hash: string
  readonly proposedBy: AgentId
}

export interface CreateAgentRecord {
  readonly projectId: ProjectId
  readonly role: Agent['role']
  readonly name: string
  readonly opencodeAgentId: string
  readonly status?: Agent['status']
  readonly capabilities?: string[]
}

export interface CreateModuleRecord {
  readonly projectId: ProjectId
  readonly name: string
  readonly ownerAgentId: AgentId
  readonly pathScope: string[]
  readonly status?: Module['status']
}

export interface CreateTaskRecord {
  readonly projectId: ProjectId
  readonly planId: PlanId
  readonly moduleId?: ModuleId
  readonly title: string
  readonly description: string
  readonly state?: Task['state']
  readonly priority?: number
  readonly ownerAgentId?: AgentId
  readonly maxAttempts?: number
  readonly reviewCycle?: number
}

export interface CreateContractRecord {
  readonly taskId: TaskId
  readonly moduleId: ModuleId
  readonly version: number
  readonly objective: string
  readonly allowedPaths: string[]
  readonly inputInterfaces: string[]
  readonly outputInterfaces: string[]
  readonly acceptanceTests: string[]
  readonly limits: Contract['limits']
  readonly deliveryFormat: string
  readonly hash: string
  readonly status?: Contract['status']
}

export interface CreateModuleVersionRecord {
  readonly moduleId: ModuleId
  readonly version: number
  readonly commitSha: string
  readonly treeHash: string
  readonly artifactHash: string
  readonly status?: ModuleVersion['status']
}

export interface CreateMessageRecord {
  readonly projectId: ProjectId
  readonly fromAgentId: AgentId
  readonly toAgentId: AgentId
  readonly correlationId: string
  readonly kind: Message['kind']
  readonly priority: number
  readonly payload: Record<string, unknown>
  readonly requiresApproval: boolean
  readonly approvedBy?: string
  readonly idempotencyKey: string
}

export interface CreateReviewRecord {
  readonly projectId: ProjectId
  readonly moduleVersionId: ModuleVersionId
  readonly judgeRole: Review['judgeRole']
  readonly verdict: Review['verdict']
  readonly findings: Review['findings']
  readonly evidence: string[]
  readonly hash: string
}

export interface CreateApprovalRecord {
  readonly projectId: ProjectId
  readonly subjectType: Approval['subjectType']
  readonly subjectId: string
  readonly subjectHash: string
  readonly approverId: string
  readonly decision: Approval['decision']
  readonly reason?: string
}

export interface AppendEventRecord {
  readonly projectId: ProjectId
  readonly type: string
  readonly aggregateType: string
  readonly aggregateId: string
  readonly actorId?: string
  readonly payload: Record<string, unknown>
  readonly traceId?: string
}

export interface AuditRecord {
  readonly projectId?: ProjectId
  readonly actorId: string
  readonly action: string
  readonly resource: string
  readonly decision: AuditEntry['decision']
  readonly reason: string
  readonly requestId?: string
}

export interface TemporaryPermissionRecord {
  readonly projectId: ProjectId
  readonly principalId: string
  readonly action: string
  readonly resource: string
  readonly effect: 'allow' | 'deny'
  readonly expiresAt: string
  readonly grantedBy: string
}

export interface SessionRecord {
  readonly id: string
  readonly projectId: ProjectId
  readonly agentId: AgentId
  readonly opencodeSessionId?: string
  readonly worktreePath?: string
  readonly status: 'STARTING' | 'ACTIVE' | 'IDLE' | 'STOPPED' | 'FAILED'
  readonly lastEventSeq?: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface LeaseRecord {
  readonly taskId: TaskId
  readonly ownerId: string
  readonly attempt: number
  readonly expiresAt: string
  readonly heartbeatAt: string
  readonly createdAt: string
}

export interface WorktreeRecord {
  readonly id: string
  readonly taskId: TaskId
  readonly moduleId?: ModuleId
  readonly path: string
  readonly branch: string
  readonly baseCommit: string
  readonly status: 'ACTIVE' | 'COMMITTED' | 'FAILED' | 'REMOVED'
  readonly createdAt: string
  readonly updatedAt: string
}

export interface JuryRunRecord {
  readonly id: string
  readonly projectId: ProjectId
  readonly taskId: TaskId
  readonly moduleVersionId: ModuleVersionId
  readonly status: 'RUNNING' | 'COMPLETED' | 'FAILED'
  readonly cycle: number
  readonly startedAt: string
  readonly completedAt?: string
  readonly createdAt: string
}

export interface ConsolidationRecord {
  readonly id: string
  readonly juryRunId: string
  readonly moduleVersionId: ModuleVersionId
  readonly verdict: 'APPROVED' | 'REWORK_REQUIRED' | 'INCOMPLETE'
  readonly blocking: unknown[]
  readonly recommendations: unknown[]
  readonly missingRoles: string[]
  readonly hash: string
  readonly createdAt: string
}

export interface ApprovedModuleRecord {
  readonly id: string
  readonly projectId: ProjectId
  readonly moduleId: ModuleId
  readonly moduleVersionId: ModuleVersionId
  readonly commitSha: string
  readonly artifactHash: string
  readonly approvedAt: string
  readonly juryRunId: string
}

export interface IntegrationRunRecord {
  readonly id: string
  readonly projectId: ProjectId
  readonly planId: PlanId
  readonly status: 'RUNNING' | 'SUCCEEDED' | 'STRUCTURAL_FAILED' | 'FAILED'
  readonly attempt: number
  readonly baseCommit: string
  readonly integrationPath: string
  readonly inputHash: string
  readonly manifestHash?: string
  readonly error?: string
  readonly createdAt: string
  readonly completedAt?: string
}

export interface IntegrationModuleRecord {
  readonly id: string
  readonly runId: string
  readonly moduleId: ModuleId
  readonly moduleVersionId: ModuleVersionId
  readonly commitSha: string
  readonly artifactHash: string
  readonly contractId?: ContractId
  readonly status: 'INCLUDED' | 'REJECTED'
  readonly createdAt: string
}

export interface IntegrationAdapterRecord {
  readonly id: string
  readonly runId: string
  readonly moduleId: ModuleId
  readonly path: string
  readonly commitSha: string
  readonly version: number
  readonly tests: unknown[]
  readonly review: unknown
  readonly status: 'VALIDATED' | 'REJECTED'
  readonly createdAt: string
}

export interface IntegrationConflictRecord {
  readonly id: string
  readonly runId: string
  readonly type: 'MINOR' | 'STRUCTURAL'
  readonly code: string
  readonly message: string
  readonly modules: ModuleId[]
  readonly evidence: string[]
  readonly resolution?: string
  readonly createdAt: string
}

export interface IntegrationManifestRecord {
  readonly id: string
  readonly projectId: ProjectId
  readonly planId: PlanId
  readonly runId: string
  readonly hash: string
  readonly baseCommit: string
  readonly manifest: Record<string, unknown>
  readonly createdAt: string
}

export interface FeedbackRunRecord {
  readonly id: string
  readonly projectId: ProjectId
  readonly planId: PlanId
  readonly manifestId: string
  readonly status: 'RUNNING' | 'COMPLETED' | 'FAILED'
  readonly verdict?: 'PASS' | 'FAIL'
  readonly report: Record<string, unknown>
  readonly hash: string
  readonly createdAt: string
  readonly completedAt?: string
}

export interface FinalDeliveryRecord {
  readonly id: string
  readonly projectId: ProjectId
  readonly manifestId: string
  readonly feedbackId: string
  readonly status: 'READY' | 'DELIVERED'
  readonly summary: Record<string, unknown>
  readonly createdAt: string
  readonly deliveredAt?: string
}

export interface TaskAttemptRecord {
  readonly id: string
  readonly taskId: TaskId
  readonly attempt: number
  readonly status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED'
  readonly sessionId?: string
  readonly startedAt: string
  readonly endedAt?: string
  readonly error?: string
}

export class StoreConflictError extends Error {
  readonly code = 'CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'StoreConflictError'
  }
}

export class SqliteStore {
  readonly db: SqliteDatabase

  constructor(db: SqliteDatabase) {
    this.db = db
  }

  static open(path: string): SqliteStore {
    return new SqliteStore(new SqliteDatabase(path))
  }

  close(): void {
    this.db.close()
  }

  get schemaVersion(): number {
    return this.db.schemaVersion
  }

  transaction<T>(callback: () => T): T {
    return this.db.transaction(callback)
  }

  createProject(record: CreateProjectRecord): Project {
    const id = createId('prj')
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO projects (id, name, repo_path, status, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [id, record.name, record.repoPath, record.status ?? 'DRAFT', timestamp, timestamp],
    )
    return this.getProject(id as ProjectId)!
  }

  getProject(id: ProjectId): Project | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM projects WHERE id = ?', [id])
    return row ? toProject(row) : undefined
  }

  getProjectByRepo(repoPath: string): Project | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM projects WHERE repo_path = ?', [repoPath])
    return row ? toProject(row) : undefined
  }

  listProjects(): Project[] {
    return this.db.all<DbRow>('SELECT * FROM projects ORDER BY created_at DESC').map(toProject)
  }

  updateProjectStatus(id: ProjectId, status: Project['status'], expectedVersion?: number): Project {
    const timestamp = nowIso()
    const result = this.db.run(
      `UPDATE projects
       SET status = ?, updated_at = ?, version = version + 1
       WHERE id = ? ${expectedVersion === undefined ? '' : 'AND version = ?'}`,
      expectedVersion === undefined
        ? [status, timestamp, id]
        : [status, timestamp, id, expectedVersion],
    )
    if (result.changes === 0) throw new StoreConflictError(`Project ${id} changed concurrently`)
    return this.getProject(id)!
  }

  createPlan(record: CreatePlanRecord): Plan {
    const id = createId('pln')
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO plans
        (id, project_id, version, title, status, spec_json, plan_json, hash, proposed_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.projectId,
        record.version,
        record.title,
        record.status ?? 'PROPOSED',
        JSON.stringify(record.spec),
        JSON.stringify(record.plan),
        record.hash,
        record.proposedBy,
        timestamp,
        timestamp,
      ],
    )
    return this.getPlan(id as PlanId)!
  }

  getPlan(id: PlanId): Plan | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM plans WHERE id = ?', [id])
    return row ? toPlan(row) : undefined
  }

  getPlanByHash(projectId: ProjectId, hash: string): Plan | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM plans WHERE project_id = ? AND hash = ?', [
      projectId,
      hash,
    ])
    return row ? toPlan(row) : undefined
  }

  listPlans(projectId: ProjectId): Plan[] {
    return this.db
      .all<DbRow>('SELECT * FROM plans WHERE project_id = ? ORDER BY version DESC', [projectId])
      .map(toPlan)
  }

  approvePlanRecord(id: PlanId, approvedBy: string, approvedAt = nowIso()): Plan {
    const result = this.db.run(
      `UPDATE plans
       SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_at = ?
       WHERE id = ? AND status = 'PROPOSED'`,
      [approvedBy, approvedAt, approvedAt, id],
    )
    if (result.changes === 0) throw new StoreConflictError(`Plan ${id} is not pending approval`)
    return this.getPlan(id)!
  }

  createAgent(record: CreateAgentRecord): Agent {
    const id = createId('agt')
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO agents
        (id, project_id, role, name, opencode_agent_id, status, capabilities_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.projectId,
        record.role,
        record.name,
        record.opencodeAgentId,
        record.status ?? 'ACTIVE',
        JSON.stringify(record.capabilities ?? []),
        timestamp,
        timestamp,
      ],
    )
    return this.getAgent(id as AgentId)!
  }

  getAgent(id: AgentId): Agent | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM agents WHERE id = ?', [id])
    return row ? toAgent(row) : undefined
  }

  getAgentByOpenCodeId(projectId: ProjectId, opencodeAgentId: string): Agent | undefined {
    const row = this.db.get<DbRow>(
      'SELECT * FROM agents WHERE project_id = ? AND opencode_agent_id = ?',
      [projectId, opencodeAgentId],
    )
    return row ? toAgent(row) : undefined
  }

  listAgents(projectId: ProjectId): Agent[] {
    return this.db
      .all<DbRow>('SELECT * FROM agents WHERE project_id = ? ORDER BY role, name', [projectId])
      .map(toAgent)
  }

  setAgentCurrentTask(agentId: AgentId, taskId: TaskId | null): void {
    this.db.run('UPDATE agents SET current_task_id = ?, updated_at = ? WHERE id = ?', [
      taskId,
      nowIso(),
      agentId,
    ])
  }

  createModule(record: CreateModuleRecord): Module {
    const id = createId('mod')
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO modules
        (id, project_id, name, owner_agent_id, path_scope_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.projectId,
        record.name,
        record.ownerAgentId,
        JSON.stringify(record.pathScope),
        record.status ?? 'DRAFT',
        timestamp,
        timestamp,
      ],
    )
    return this.getModule(id as ModuleId)!
  }

  getModule(id: ModuleId): Module | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM modules WHERE id = ?', [id])
    return row ? toModule(row) : undefined
  }

  listModules(projectId: ProjectId): Module[] {
    return this.db
      .all<DbRow>('SELECT * FROM modules WHERE project_id = ? ORDER BY name', [projectId])
      .map(toModule)
  }

  setModuleCurrentVersion(moduleId: ModuleId, versionId: ModuleVersionId | null): void {
    this.db.run('UPDATE modules SET current_version_id = ?, updated_at = ? WHERE id = ?', [
      versionId,
      nowIso(),
      moduleId,
    ])
  }

  createTask(record: CreateTaskRecord): Task {
    const id = createId('tsk')
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO tasks
        (id, project_id, plan_id, module_id, title, description, state, priority, owner_agent_id,
         attempt_count, max_attempts, review_cycle, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0)`,
      [
        id,
        record.projectId,
        record.planId,
        record.moduleId ?? null,
        record.title,
        record.description,
        record.state ?? 'PENDING',
        record.priority ?? 50,
        record.ownerAgentId ?? null,
        record.maxAttempts ?? 3,
        record.reviewCycle ?? 0,
        timestamp,
        timestamp,
      ],
    )
    return this.getTask(id as TaskId)!
  }

  getTask(id: TaskId): Task | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM tasks WHERE id = ?', [id])
    return row ? toTask(row) : undefined
  }

  listTasks(projectId: ProjectId): Task[] {
    return this.db
      .all<DbRow>('SELECT * FROM tasks WHERE project_id = ? ORDER BY priority DESC, created_at', [
        projectId,
      ])
      .map(toTask)
  }

  incrementTaskAttempt(id: TaskId): Task {
    const result = this.db.run(
      'UPDATE tasks SET attempt_count = attempt_count + 1, updated_at = ?, version = version + 1 WHERE id = ?',
      [nowIso(), id],
    )
    if (result.changes === 0) throw new StoreConflictError(`Task ${id} not found`)
    return this.getTask(id)!
  }

  createSession(record: {
    readonly projectId: ProjectId
    readonly agentId: AgentId
    readonly opencodeSessionId?: string
    readonly worktreePath?: string
    readonly status?: SessionRecord['status']
  }): SessionRecord {
    const id = createId('ses')
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO sessions
        (id, project_id, agent_id, opencode_session_id, worktree_path, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.projectId,
        record.agentId,
        record.opencodeSessionId ?? null,
        record.worktreePath ?? null,
        record.status ?? 'STARTING',
        timestamp,
        timestamp,
      ],
    )
    return this.getSession(id)!
  }

  getSession(id: string): SessionRecord | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM sessions WHERE id = ?', [id])
    return row ? toSessionRecord(row) : undefined
  }

  getSessionByOpenCodeId(opencodeSessionId: string): SessionRecord | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM sessions WHERE opencode_session_id = ?', [
      opencodeSessionId,
    ])
    return row ? toSessionRecord(row) : undefined
  }

  listSessions(projectId: ProjectId): SessionRecord[] {
    return this.db
      .all<DbRow>('SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at DESC', [
        projectId,
      ])
      .map(toSessionRecord)
  }

  updateSessionStatus(
    id: string,
    status: SessionRecord['status'],
    lastEventSeq?: number,
  ): SessionRecord {
    const result = this.db.run(
      `UPDATE sessions
       SET status = ?, last_event_seq = COALESCE(?, last_event_seq), updated_at = ?
       WHERE id = ?`,
      [status, lastEventSeq ?? null, nowIso(), id],
    )
    if (result.changes === 0) throw new StoreConflictError(`Session ${id} not found`)
    return this.getSession(id)!
  }

  createLease(record: {
    readonly taskId: TaskId
    readonly ownerId: string
    readonly attempt: number
    readonly expiresAt: string
  }): LeaseRecord {
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO leases (task_id, owner_id, attempt, expires_at, heartbeat_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [record.taskId, record.ownerId, record.attempt, record.expiresAt, timestamp, timestamp],
    )
    return this.getLease(record.taskId)!
  }

  getLease(taskId: TaskId): LeaseRecord | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM leases WHERE task_id = ?', [taskId])
    return row ? toLease(row) : undefined
  }

  renewLease(taskId: TaskId, expiresAt: string): LeaseRecord {
    const result = this.db.run(
      'UPDATE leases SET expires_at = ?, heartbeat_at = ? WHERE task_id = ?',
      [expiresAt, nowIso(), taskId],
    )
    if (result.changes === 0) throw new StoreConflictError(`Lease for ${taskId} not found`)
    return this.getLease(taskId)!
  }

  deleteLease(taskId: TaskId): void {
    this.db.run('DELETE FROM leases WHERE task_id = ?', [taskId])
  }

  listActiveLeases(): LeaseRecord[] {
    return this.db
      .all<DbRow>('SELECT * FROM leases WHERE expires_at > ? ORDER BY created_at', [nowIso()])
      .map(toLease)
  }

  listExpiredLeases(): LeaseRecord[] {
    return this.db
      .all<DbRow>('SELECT * FROM leases WHERE expires_at <= ? ORDER BY created_at', [nowIso()])
      .map(toLease)
  }

  createWorktree(record: {
    readonly taskId: TaskId
    readonly moduleId?: ModuleId
    readonly path: string
    readonly branch: string
    readonly baseCommit: string
    readonly status?: WorktreeRecord['status']
  }): WorktreeRecord {
    const id = createId('wtr')
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO worktrees
        (id, task_id, module_id, path, branch, base_commit, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.taskId,
        record.moduleId ?? null,
        record.path,
        record.branch,
        record.baseCommit,
        record.status ?? 'ACTIVE',
        timestamp,
        timestamp,
      ],
    )
    return this.getWorktreeByTask(record.taskId)!
  }

  getWorktreeByTask(taskId: TaskId): WorktreeRecord | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM worktrees WHERE task_id = ?', [taskId])
    return row ? toWorktree(row) : undefined
  }

  listWorktrees(projectId: ProjectId): WorktreeRecord[] {
    return this.db
      .all<DbRow>(
        `SELECT w.* FROM worktrees w
         JOIN tasks t ON t.id = w.task_id
         WHERE t.project_id = ?
         ORDER BY w.created_at DESC`,
        [projectId],
      )
      .map(toWorktree)
  }

  updateModuleStatus(id: ModuleId, status: Module['status']): Module {
    this.db.run('UPDATE modules SET status = ?, updated_at = ? WHERE id = ?', [
      status,
      nowIso(),
      id,
    ])
    return this.getModule(id)!
  }

  updateModuleVersionStatus(id: ModuleVersionId, status: ModuleVersion['status']): ModuleVersion {
    this.db.run('UPDATE module_versions SET status = ? WHERE id = ?', [status, id])
    return this.getModuleVersion(id)!
  }

  updateWorktreeStatus(id: string, status: WorktreeRecord['status']): WorktreeRecord {
    const result = this.db.run('UPDATE worktrees SET status = ?, updated_at = ? WHERE id = ?', [
      status,
      nowIso(),
      id,
    ])
    if (result.changes === 0) throw new StoreConflictError(`Worktree ${id} not found`)
    const row = this.db.get<DbRow>('SELECT * FROM worktrees WHERE id = ?', [id])
    return toWorktree(row!)
  }

  createTaskAttempt(record: {
    readonly taskId: TaskId
    readonly attempt: number
    readonly sessionId?: string
    readonly status?: TaskAttemptRecord['status']
  }): TaskAttemptRecord {
    const id = createId('att')
    this.db.run(
      `INSERT INTO task_attempts
        (id, task_id, attempt, status, session_id, started_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.taskId,
        record.attempt,
        record.status ?? 'RUNNING',
        record.sessionId ?? null,
        nowIso(),
      ],
    )
    return this.getTaskAttempt(id)!
  }

  getTaskAttempt(id: string): TaskAttemptRecord | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM task_attempts WHERE id = ?', [id])
    return row ? toTaskAttempt(row) : undefined
  }

  updateTaskAttempt(
    id: string,
    status: TaskAttemptRecord['status'],
    options: { sessionId?: string; error?: string } = {},
  ): TaskAttemptRecord {
    const result = this.db.run(
      `UPDATE task_attempts
       SET status = ?, session_id = COALESCE(?, session_id), ended_at = ?, error = ?
       WHERE id = ?`,
      [
        status,
        options.sessionId ?? null,
        status === 'RUNNING' ? null : nowIso(),
        options.error ? redactText(options.error).slice(0, 1000) : null,
        id,
      ],
    )
    if (result.changes === 0) throw new StoreConflictError(`Task attempt ${id} not found`)
    return this.getTaskAttempt(id)!
  }

  listTaskAttempts(taskId: TaskId): TaskAttemptRecord[] {
    return this.db
      .all<DbRow>('SELECT * FROM task_attempts WHERE task_id = ? ORDER BY attempt', [taskId])
      .map(toTaskAttempt)
  }

  updateTaskState(id: TaskId, state: Task['state'], expectedVersion?: number): Task {
    const result = this.db.run(
      `UPDATE tasks
       SET state = ?, updated_at = ?, version = version + 1
       WHERE id = ? ${expectedVersion === undefined ? '' : 'AND version = ?'}`,
      expectedVersion === undefined
        ? [state, nowIso(), id]
        : [state, nowIso(), id, expectedVersion],
    )
    if (result.changes === 0) throw new StoreConflictError(`Task ${id} changed concurrently`)
    return this.getTask(id)!
  }

  assignTask(id: TaskId, ownerAgentId: AgentId | null): Task {
    const result = this.db.run(
      'UPDATE tasks SET owner_agent_id = ?, updated_at = ?, version = version + 1 WHERE id = ?',
      [ownerAgentId, nowIso(), id],
    )
    if (result.changes === 0) throw new StoreConflictError(`Task ${id} not found`)
    return this.getTask(id)!
  }

  setTaskPriority(id: TaskId, priority: number): Task {
    const result = this.db.run(
      'UPDATE tasks SET priority = ?, updated_at = ?, version = version + 1 WHERE id = ?',
      [priority, nowIso(), id],
    )
    if (result.changes === 0) throw new StoreConflictError(`Task ${id} not found`)
    return this.getTask(id)!
  }

  setTaskContract(id: TaskId, contractId: ContractId | null): Task {
    const result = this.db.run(
      'UPDATE tasks SET contract_id = ?, updated_at = ?, version = version + 1 WHERE id = ?',
      [contractId, nowIso(), id],
    )
    if (result.changes === 0) throw new StoreConflictError(`Task ${id} not found`)
    return this.getTask(id)!
  }

  setTaskLease(id: TaskId, leaseExpiresAt: string | null): Task {
    const result = this.db.run(
      'UPDATE tasks SET lease_expires_at = ?, updated_at = ?, version = version + 1 WHERE id = ?',
      [leaseExpiresAt, nowIso(), id],
    )
    if (result.changes === 0) throw new StoreConflictError(`Task ${id} not found`)
    return this.getTask(id)!
  }

  addTaskDependency(
    taskId: TaskId,
    dependsOnTaskId: TaskId,
    kind: TaskDependency['kind'] = 'REQUIRES',
  ): TaskDependency {
    this.db.run(
      'INSERT INTO task_dependencies (task_id, depends_on_task_id, kind) VALUES (?, ?, ?)',
      [taskId, dependsOnTaskId, kind],
    )
    return { taskId, dependsOnTaskId, kind }
  }

  listTaskDependencies(taskId: TaskId): TaskDependency[] {
    return this.db
      .all<DbRow>('SELECT * FROM task_dependencies WHERE task_id = ? ORDER BY depends_on_task_id', [
        taskId,
      ])
      .map(toTaskDependency)
  }

  listDependenciesForProject(projectId: ProjectId): TaskDependency[] {
    return this.db
      .all<DbRow>(
        `SELECT d.* FROM task_dependencies d
         JOIN tasks t ON t.id = d.task_id
         WHERE t.project_id = ?
         ORDER BY d.task_id, d.depends_on_task_id`,
        [projectId],
      )
      .map(toTaskDependency)
  }

  createContract(record: CreateContractRecord): Contract {
    const id = createId('ctr')
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO contracts
        (id, task_id, module_id, version, objective, allowed_paths_json, input_interfaces_json,
         output_interfaces_json, acceptance_tests_json, limits_json, delivery_format, hash, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.taskId,
        record.moduleId,
        record.version,
        record.objective,
        JSON.stringify(record.allowedPaths),
        JSON.stringify(record.inputInterfaces),
        JSON.stringify(record.outputInterfaces),
        JSON.stringify(record.acceptanceTests),
        JSON.stringify(record.limits),
        record.deliveryFormat,
        record.hash,
        record.status ?? 'ACTIVE',
        timestamp,
      ],
    )
    return this.getContract(id as ContractId)!
  }

  getContract(id: ContractId): Contract | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM contracts WHERE id = ?', [id])
    return row ? toContract(row) : undefined
  }

  listContracts(projectId: ProjectId): Contract[] {
    return this.db
      .all<DbRow>(
        `SELECT c.* FROM contracts c
         JOIN modules m ON m.id = c.module_id
         WHERE m.project_id = ?
         ORDER BY c.created_at DESC`,
        [projectId],
      )
      .map(toContract)
  }

  createModuleVersion(record: CreateModuleVersionRecord): ModuleVersion {
    const id = createId('mdv')
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO module_versions
        (id, module_id, version, commit_sha, tree_hash, artifact_hash, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.moduleId,
        record.version,
        record.commitSha,
        record.treeHash,
        record.artifactHash,
        record.status ?? 'IN_REVIEW',
        timestamp,
      ],
    )
    return this.getModuleVersion(id as ModuleVersionId)!
  }

  getModuleVersion(id: ModuleVersionId): ModuleVersion | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM module_versions WHERE id = ?', [id])
    return row ? toModuleVersion(row) : undefined
  }

  listModuleVersions(moduleId: ModuleId): ModuleVersion[] {
    return this.db
      .all<DbRow>('SELECT * FROM module_versions WHERE module_id = ? ORDER BY version DESC', [
        moduleId,
      ])
      .map(toModuleVersion)
  }

  createMessage(record: CreateMessageRecord): Message {
    const id = createId('msg')
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO messages
        (id, project_id, from_agent_id, to_agent_id, correlation_id, kind, priority, state,
         payload_json, requires_approval, approved_by, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?)`,
      [
        id,
        record.projectId,
        record.fromAgentId,
        record.toAgentId,
        record.correlationId,
        record.kind,
        record.priority,
        JSON.stringify(redact(record.payload)),
        record.requiresApproval ? 1 : 0,
        record.approvedBy ?? null,
        record.idempotencyKey,
        timestamp,
      ],
    )
    return this.getMessage(id as MessageId)!
  }

  getMessage(id: MessageId): Message | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM messages WHERE id = ?', [id])
    return row ? toMessage(row) : undefined
  }

  getMessageByIdempotency(projectId: ProjectId, idempotencyKey: string): Message | undefined {
    const row = this.db.get<DbRow>(
      'SELECT * FROM messages WHERE project_id = ? AND idempotency_key = ?',
      [projectId, idempotencyKey],
    )
    return row ? toMessage(row) : undefined
  }

  listMessages(projectId: ProjectId, toAgentId: AgentId, limit = 100): Message[] {
    return this.db
      .all<DbRow>(
        `SELECT * FROM messages
         WHERE project_id = ? AND to_agent_id = ?
         ORDER BY created_at DESC LIMIT ?`,
        [projectId, toAgentId, limit],
      )
      .map(toMessage)
  }

  updateMessageState(
    id: MessageId,
    state: Message['state'],
    timestamps: { deliveredAt?: string; ackedAt?: string } = {},
  ): Message {
    const result = this.db.run(
      `UPDATE messages
       SET state = ?, delivered_at = COALESCE(?, delivered_at), acked_at = COALESCE(?, acked_at)
       WHERE id = ?`,
      [state, timestamps.deliveredAt ?? null, timestamps.ackedAt ?? null, id],
    )
    if (result.changes === 0) throw new StoreConflictError(`Message ${id} not found`)
    return this.getMessage(id)!
  }

  createReview(record: CreateReviewRecord): Review {
    const id = createId('rev')
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO reviews
        (id, project_id, module_version_id, judge_role, verdict, findings_json, evidence_json, hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.projectId,
        record.moduleVersionId,
        record.judgeRole,
        record.verdict,
        JSON.stringify(record.findings),
        JSON.stringify(record.evidence),
        record.hash,
        timestamp,
      ],
    )
    return this.getReview(id as ReviewId)!
  }

  getReview(id: ReviewId): Review | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM reviews WHERE id = ?', [id])
    return row ? toReview(row) : undefined
  }

  listReviews(projectId: ProjectId): Review[] {
    return this.db
      .all<DbRow>('SELECT * FROM reviews WHERE project_id = ? ORDER BY created_at DESC', [
        projectId,
      ])
      .map(toReview)
  }

  listReviewsForVersion(moduleVersionId: ModuleVersionId): Review[] {
    return this.db
      .all<DbRow>('SELECT * FROM reviews WHERE module_version_id = ? ORDER BY judge_role', [
        moduleVersionId,
      ])
      .map(toReview)
  }

  createJuryRun(record: {
    readonly projectId: ProjectId
    readonly taskId: TaskId
    readonly moduleVersionId: ModuleVersionId
    readonly cycle: number
  }): JuryRunRecord {
    const id = createId('jur')
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO jury_runs
        (id, project_id, task_id, module_version_id, status, cycle, started_at, created_at)
       VALUES (?, ?, ?, ?, 'RUNNING', ?, ?, ?)`,
      [
        id,
        record.projectId,
        record.taskId,
        record.moduleVersionId,
        record.cycle,
        timestamp,
        timestamp,
      ],
    )
    return this.getJuryRun(id)!
  }

  getJuryRun(id: string): JuryRunRecord | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM jury_runs WHERE id = ?', [id])
    return row ? toJuryRun(row) : undefined
  }

  getJuryRunByVersion(moduleVersionId: ModuleVersionId): JuryRunRecord | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM jury_runs WHERE module_version_id = ?', [
      moduleVersionId,
    ])
    return row ? toJuryRun(row) : undefined
  }

  updateJuryRunStatus(id: string, status: JuryRunRecord['status']): JuryRunRecord {
    this.db.run('UPDATE jury_runs SET status = ?, completed_at = ? WHERE id = ?', [
      status,
      status === 'RUNNING' ? null : nowIso(),
      id,
    ])
    return this.getJuryRun(id)!
  }

  listJuryRuns(projectId: ProjectId): JuryRunRecord[] {
    return this.db
      .all<DbRow>('SELECT * FROM jury_runs WHERE project_id = ? ORDER BY created_at DESC', [
        projectId,
      ])
      .map(toJuryRun)
  }

  createConsolidation(record: {
    readonly juryRunId: string
    readonly moduleVersionId: ModuleVersionId
    readonly verdict: ConsolidationRecord['verdict']
    readonly blocking: unknown[]
    readonly recommendations: unknown[]
    readonly missingRoles: string[]
    readonly hash: string
  }): ConsolidationRecord {
    const id = createId('con')
    this.db.run(
      `INSERT INTO jury_consolidations
        (id, jury_run_id, module_version_id, verdict, blocking_json, recommendations_json,
         missing_roles_json, hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.juryRunId,
        record.moduleVersionId,
        record.verdict,
        JSON.stringify(record.blocking),
        JSON.stringify(record.recommendations),
        JSON.stringify(record.missingRoles),
        record.hash,
        nowIso(),
      ],
    )
    return this.getConsolidation(id)!
  }

  getConsolidation(id: string): ConsolidationRecord | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM jury_consolidations WHERE id = ?', [id])
    return row ? toConsolidation(row) : undefined
  }

  getConsolidationByVersion(moduleVersionId: ModuleVersionId): ConsolidationRecord | undefined {
    const row = this.db.get<DbRow>(
      'SELECT * FROM jury_consolidations WHERE module_version_id = ?',
      [moduleVersionId],
    )
    return row ? toConsolidation(row) : undefined
  }

  listConsolidations(projectId: ProjectId): ConsolidationRecord[] {
    return this.db
      .all<DbRow>(
        `SELECT c.* FROM jury_consolidations c
         JOIN jury_runs j ON j.id = c.jury_run_id
         WHERE j.project_id = ?
         ORDER BY c.created_at DESC`,
        [projectId],
      )
      .map(toConsolidation)
  }

  createApprovedModule(record: {
    readonly projectId: ProjectId
    readonly moduleId: ModuleId
    readonly moduleVersionId: ModuleVersionId
    readonly commitSha: string
    readonly artifactHash: string
    readonly juryRunId: string
  }): ApprovedModuleRecord {
    const id = createId('apm')
    this.db.run(
      `INSERT INTO approved_modules
        (id, project_id, module_id, module_version_id, commit_sha, artifact_hash, approved_at, jury_run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.projectId,
        record.moduleId,
        record.moduleVersionId,
        record.commitSha,
        record.artifactHash,
        nowIso(),
        record.juryRunId,
      ],
    )
    return this.getApprovedModuleByVersion(record.moduleVersionId)!
  }

  getApprovedModuleByVersion(moduleVersionId: ModuleVersionId): ApprovedModuleRecord | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM approved_modules WHERE module_version_id = ?', [
      moduleVersionId,
    ])
    return row ? toApprovedModule(row) : undefined
  }

  listApprovedModules(projectId: ProjectId): ApprovedModuleRecord[] {
    return this.db
      .all<DbRow>('SELECT * FROM approved_modules WHERE project_id = ? ORDER BY approved_at DESC', [
        projectId,
      ])
      .map(toApprovedModule)
  }

  createApproval(record: CreateApprovalRecord): Approval {
    const id = createId('apr')
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO approvals
        (id, project_id, subject_type, subject_id, subject_hash, approver_id, decision, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.projectId,
        record.subjectType,
        record.subjectId,
        record.subjectHash,
        record.approverId,
        record.decision,
        record.reason ? redactText(record.reason) : null,
        timestamp,
      ],
    )
    return this.getApproval(id as ApprovalId)!
  }

  getApproval(id: ApprovalId): Approval | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM approvals WHERE id = ?', [id])
    return row ? toApproval(row) : undefined
  }

  listApprovals(projectId: ProjectId): Approval[] {
    return this.db
      .all<DbRow>('SELECT * FROM approvals WHERE project_id = ? ORDER BY created_at DESC', [
        projectId,
      ])
      .map(toApproval)
  }

  findApproval(
    projectId: ProjectId,
    subjectType: Approval['subjectType'],
    subjectId: string,
    subjectHash: string,
    approverId: string,
  ): Approval | undefined {
    const row = this.db.get<DbRow>(
      `SELECT * FROM approvals
       WHERE project_id = ? AND subject_type = ? AND subject_id = ?
         AND subject_hash = ? AND approver_id = ?
       LIMIT 1`,
      [projectId, subjectType, subjectId, subjectHash, approverId],
    )
    return row ? toApproval(row) : undefined
  }

  appendEvent(record: AppendEventRecord): Event {
    const id = createId('evt')
    const timestamp = nowIso()
    const payload = redact(record.payload)
    const result = this.db.run(
      `INSERT INTO events
        (id, project_id, type, aggregate_type, aggregate_id, actor_id, payload_json, trace_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.projectId,
        record.type,
        record.aggregateType,
        record.aggregateId,
        record.actorId ?? null,
        JSON.stringify(payload),
        record.traceId ?? null,
        timestamp,
      ],
    )
    return this.getEventBySeq(result.lastInsertRowid)!
  }

  getEventBySeq(seq: number): Event | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM events WHERE seq = ?', [seq])
    return row ? toEvent(row) : undefined
  }

  listEvents(projectId: ProjectId, limit = 100, afterSeq = 0): Event[] {
    return this.db
      .all<DbRow>(
        `SELECT * FROM events
         WHERE project_id = ? AND seq > ?
         ORDER BY seq DESC LIMIT ?`,
        [projectId, afterSeq, limit],
      )
      .map(toEvent)
  }

  appendOutbox(eventId: EventId, topic: string, payload: Record<string, unknown>): string {
    const id = createId('obx')
    this.db.run(
      `INSERT INTO event_outbox
        (id, event_id, topic, payload_json, status, attempts, created_at)
       VALUES (?, ?, ?, ?, 'PENDING', 0, ?)`,
      [id, eventId, topic, JSON.stringify(redact(payload)), nowIso()],
    )
    return id
  }

  listOutbox(
    status?: 'PENDING' | 'DELIVERING' | 'DELIVERED' | 'FAILED',
  ): Array<Record<string, unknown>> {
    const rows = status
      ? this.db.all<DbRow>(
          'SELECT * FROM event_outbox WHERE status = ? ORDER BY created_at LIMIT 500',
          [status],
        )
      : this.db.all<DbRow>('SELECT * FROM event_outbox ORDER BY created_at DESC LIMIT 500')
    return rows.map((row) => ({
      id: text(row, 'id'),
      eventId: text(row, 'event_id'),
      topic: text(row, 'topic'),
      status: text(row, 'status'),
      attempts: integer(row, 'attempts'),
      payload: json(row, 'payload_json'),
      createdAt: text(row, 'created_at'),
      deliveredAt: optionalText(row, 'delivered_at'),
    }))
  }

  listOutboxForProject(
    projectId: ProjectId,
    status?: 'PENDING' | 'DELIVERING' | 'DELIVERED' | 'FAILED',
  ): Array<Record<string, unknown>> {
    const rows = this.db.all<DbRow>(
      `SELECT o.* FROM event_outbox o
       JOIN events e ON e.id = o.event_id
       WHERE e.project_id = ? ${status ? 'AND o.status = ?' : ''}
       ORDER BY o.created_at DESC LIMIT 500`,
      status ? [projectId, status] : [projectId],
    )
    return rows.map((row) => ({
      id: text(row, 'id'),
      eventId: text(row, 'event_id'),
      topic: text(row, 'topic'),
      status: text(row, 'status'),
      attempts: integer(row, 'attempts'),
      payload: json(row, 'payload_json'),
      createdAt: text(row, 'created_at'),
      deliveredAt: optionalText(row, 'delivered_at'),
    }))
  }

  listPendingOutbox(limit = 100): Array<Record<string, unknown>> {
    const rows = this.db.all<DbRow>(
      `SELECT * FROM event_outbox
       WHERE status = 'PENDING'
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY created_at ASC LIMIT ?`,
      [nowIso(), limit],
    )
    return rows.map((row) => ({
      id: text(row, 'id'),
      eventId: text(row, 'event_id'),
      topic: text(row, 'topic'),
      payload: json(row, 'payload_json'),
      attempts: integer(row, 'attempts'),
      createdAt: text(row, 'created_at'),
    }))
  }

  markOutboxDelivered(id: string): void {
    this.db.run(
      `UPDATE event_outbox
       SET status = 'DELIVERED', attempts = attempts + 1, delivered_at = ?
       WHERE id = ?`,
      [nowIso(), id],
    )
  }

  markOutboxFailed(id: string, error: string, nextAttemptAt: string | null, final: boolean): void {
    this.db.run(
      `UPDATE event_outbox
       SET status = ?, attempts = attempts + 1, last_error = ?, next_attempt_at = ?
       WHERE id = ?`,
      [final ? 'FAILED' : 'PENDING', redactText(error).slice(0, 500), nextAttemptAt, id],
    )
  }

  createCheckpoint(
    projectId: ProjectId,
    scope: string,
    state: Record<string, unknown>,
    hash: string,
  ): Checkpoint {
    const id = createId('chk')
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO checkpoints (id, project_id, scope, state_json, hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, projectId, scope, JSON.stringify(redact(state)), hash, timestamp],
    )
    return this.getCheckpoint(id as CheckpointId)!
  }

  getCheckpoint(id: CheckpointId): Checkpoint | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM checkpoints WHERE id = ?', [id])
    return row ? toCheckpoint(row) : undefined
  }

  listCheckpoints(projectId: ProjectId, scope?: string): Checkpoint[] {
    return (
      scope
        ? this.db.all<DbRow>(
            'SELECT * FROM checkpoints WHERE project_id = ? AND scope = ? ORDER BY created_at DESC',
            [projectId, scope],
          )
        : this.db.all<DbRow>(
            'SELECT * FROM checkpoints WHERE project_id = ? ORDER BY created_at DESC',
            [projectId],
          )
    ).map(toCheckpoint)
  }

  writeAudit(record: AuditRecord): AuditEntry {
    const id = createId('aud')
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO audit_log
        (id, project_id, actor_id, action, resource, decision, reason, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.projectId ?? null,
        record.actorId,
        record.action,
        record.resource,
        record.decision,
        redactText(record.reason),
        record.requestId ?? null,
        timestamp,
      ],
    )
    return this.getAudit(id as AuditId)!
  }

  getAudit(id: AuditId): AuditEntry | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM audit_log WHERE id = ?', [id])
    return row ? toAuditEntry(row) : undefined
  }

  listAudit(projectId: ProjectId, decision?: AuditEntry['decision'], limit = 100): AuditEntry[] {
    return this.db
      .all<DbRow>(
        `SELECT * FROM audit_log
         WHERE project_id = ? ${decision ? 'AND decision = ?' : ''}
         ORDER BY created_at DESC LIMIT ?`,
        decision ? [projectId, decision, limit] : [projectId, limit],
      )
      .map(toAuditEntry)
  }

  writeTemporaryPermission(record: TemporaryPermissionRecord): string {
    const id = createId('tmp')
    this.db.run(
      `INSERT INTO temporary_permissions
        (id, project_id, principal_id, action, resource, effect, expires_at, granted_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.projectId,
        record.principalId,
        record.action,
        record.resource,
        record.effect,
        record.expiresAt,
        record.grantedBy,
        nowIso(),
      ],
    )
    return id
  }

  listActiveTemporaryPermissions(
    projectId: ProjectId,
    principalId: string,
    action: string,
    resource: string,
  ): Array<{ effect: 'allow' | 'deny'; expiresAt: string }> {
    return this.db
      .all<DbRow>(
        `SELECT effect, expires_at FROM temporary_permissions
         WHERE project_id = ? AND principal_id = ? AND action = ?
           AND (resource = ? OR resource = '*')
           AND revoked_at IS NULL AND expires_at > ?
         ORDER BY created_at DESC`,
        [projectId, principalId, action, resource, nowIso()],
      )
      .map((row) => ({
        effect: text(row, 'effect') as 'allow' | 'deny',
        expiresAt: text(row, 'expires_at'),
      }))
  }

  createIntegrationRun(record: {
    readonly projectId: ProjectId
    readonly planId: PlanId
    readonly attempt: number
    readonly baseCommit: string
    readonly integrationPath: string
    readonly inputHash: string
  }): IntegrationRunRecord {
    const id = createId('irn')
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO integration_runs
        (id, project_id, plan_id, status, attempt, base_commit, integration_path, input_hash,
         created_at)
       VALUES (?, ?, ?, 'RUNNING', ?, ?, ?, ?, ?)`,
      [
        id,
        record.projectId,
        record.planId,
        record.attempt,
        record.baseCommit,
        record.integrationPath,
        record.inputHash,
        timestamp,
      ],
    )
    return this.getIntegrationRun(id)!
  }

  getIntegrationRun(id: string): IntegrationRunRecord | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM integration_runs WHERE id = ?', [id])
    return row ? toIntegrationRun(row) : undefined
  }

  latestIntegrationAttempt(projectId: ProjectId, planId: PlanId, inputHash: string): number {
    const row = this.db.get<DbRow>(
      `SELECT COALESCE(MAX(attempt), 0) AS attempt FROM integration_runs
       WHERE project_id = ? AND plan_id = ? AND input_hash = ?`,
      [projectId, planId, inputHash],
    )
    return row ? integer(row, 'attempt') : 0
  }

  findReusableIntegrationRun(
    projectId: ProjectId,
    planId: PlanId,
    inputHash: string,
  ): IntegrationRunRecord | undefined {
    const row = this.db.get<DbRow>(
      `SELECT r.* FROM integration_runs r
       JOIN integration_manifests m ON m.run_id = r.id
       WHERE r.project_id = ? AND r.plan_id = ? AND r.input_hash = ?
         AND r.status = 'SUCCEEDED'
       ORDER BY r.attempt DESC LIMIT 1`,
      [projectId, planId, inputHash],
    )
    return row ? toIntegrationRun(row) : undefined
  }

  updateIntegrationRun(
    id: string,
    patch: {
      readonly status: IntegrationRunRecord['status']
      readonly manifestHash?: string
      readonly error?: string
    },
  ): IntegrationRunRecord {
    const result = this.db.run(
      `UPDATE integration_runs
       SET status = ?, manifest_hash = COALESCE(?, manifest_hash), error = ?, completed_at = ?
       WHERE id = ?`,
      [
        patch.status,
        patch.manifestHash ?? null,
        patch.error ? redactText(patch.error).slice(0, 2000) : null,
        patch.status === 'RUNNING' ? null : nowIso(),
        id,
      ],
    )
    if (result.changes === 0) throw new StoreConflictError(`Integration run ${id} not found`)
    return this.getIntegrationRun(id)!
  }

  listIntegrationRuns(projectId: ProjectId): IntegrationRunRecord[] {
    return this.db
      .all<DbRow>('SELECT * FROM integration_runs WHERE project_id = ? ORDER BY created_at DESC', [
        projectId,
      ])
      .map(toIntegrationRun)
  }

  createIntegrationModule(record: {
    readonly runId: string
    readonly moduleId: ModuleId
    readonly moduleVersionId: ModuleVersionId
    readonly commitSha: string
    readonly artifactHash: string
    readonly contractId?: ContractId
    readonly status?: IntegrationModuleRecord['status']
  }): IntegrationModuleRecord {
    const id = createId('imd')
    this.db.run(
      `INSERT INTO integration_modules
        (id, run_id, module_id, module_version_id, commit_sha, artifact_hash, contract_id,
         status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.runId,
        record.moduleId,
        record.moduleVersionId,
        record.commitSha,
        record.artifactHash,
        record.contractId ?? null,
        record.status ?? 'INCLUDED',
        nowIso(),
      ],
    )
    const row = this.db.get<DbRow>('SELECT * FROM integration_modules WHERE id = ?', [id])
    return toIntegrationModule(row!)
  }

  listIntegrationModules(runId: string): IntegrationModuleRecord[] {
    return this.db
      .all<DbRow>('SELECT * FROM integration_modules WHERE run_id = ? ORDER BY module_id', [runId])
      .map(toIntegrationModule)
  }

  createIntegrationAdapter(record: {
    readonly runId: string
    readonly moduleId: ModuleId
    readonly path: string
    readonly commitSha: string
    readonly version: number
    readonly tests: unknown[]
    readonly review: unknown
    readonly status?: IntegrationAdapterRecord['status']
  }): IntegrationAdapterRecord {
    const id = createId('iad')
    this.db.run(
      `INSERT INTO integration_adapters
        (id, run_id, module_id, path, commit_sha, version, tests_json, review_json, status,
         created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.runId,
        record.moduleId,
        record.path,
        record.commitSha,
        record.version,
        JSON.stringify(redact(record.tests)),
        JSON.stringify(redact(record.review)),
        record.status ?? 'VALIDATED',
        nowIso(),
      ],
    )
    const row = this.db.get<DbRow>('SELECT * FROM integration_adapters WHERE id = ?', [id])
    return toIntegrationAdapter(row!)
  }

  listIntegrationAdapters(runId: string): IntegrationAdapterRecord[] {
    return this.db
      .all<DbRow>('SELECT * FROM integration_adapters WHERE run_id = ? ORDER BY path', [runId])
      .map(toIntegrationAdapter)
  }

  createIntegrationConflict(record: {
    readonly runId: string
    readonly type: IntegrationConflictRecord['type']
    readonly code: string
    readonly message: string
    readonly modules: readonly ModuleId[]
    readonly evidence: readonly string[]
    readonly resolution?: string
  }): IntegrationConflictRecord {
    const id = createId('icf')
    this.db.run(
      `INSERT INTO integration_conflicts
        (id, run_id, type, code, message, modules_json, evidence_json, resolution, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.runId,
        record.type,
        record.code,
        redactText(record.message),
        JSON.stringify(record.modules),
        JSON.stringify(record.evidence.map(redactText)),
        record.resolution ? redactText(record.resolution) : null,
        nowIso(),
      ],
    )
    const row = this.db.get<DbRow>('SELECT * FROM integration_conflicts WHERE id = ?', [id])
    return toIntegrationConflict(row!)
  }

  listIntegrationConflicts(runId: string): IntegrationConflictRecord[] {
    return this.db
      .all<DbRow>('SELECT * FROM integration_conflicts WHERE run_id = ? ORDER BY created_at', [
        runId,
      ])
      .map(toIntegrationConflict)
  }

  createIntegrationManifest(record: {
    readonly projectId: ProjectId
    readonly planId: PlanId
    readonly runId: string
    readonly hash: string
    readonly baseCommit: string
    readonly manifest: Record<string, unknown>
  }): IntegrationManifestRecord {
    const id = createId('imn')
    this.db.run(
      `INSERT INTO integration_manifests
        (id, project_id, plan_id, run_id, hash, base_commit, manifest_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.projectId,
        record.planId,
        record.runId,
        record.hash,
        record.baseCommit,
        JSON.stringify(redact(record.manifest)),
        nowIso(),
      ],
    )
    return this.getIntegrationManifest(id)!
  }

  getIntegrationManifest(id: string): IntegrationManifestRecord | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM integration_manifests WHERE id = ?', [id])
    return row ? toIntegrationManifest(row) : undefined
  }

  getIntegrationManifestByRun(runId: string): IntegrationManifestRecord | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM integration_manifests WHERE run_id = ?', [runId])
    return row ? toIntegrationManifest(row) : undefined
  }

  getIntegrationManifestByHash(
    projectId: ProjectId,
    hash: string,
  ): IntegrationManifestRecord | undefined {
    const row = this.db.get<DbRow>(
      'SELECT * FROM integration_manifests WHERE project_id = ? AND hash = ?',
      [projectId, hash],
    )
    return row ? toIntegrationManifest(row) : undefined
  }

  listIntegrationManifests(projectId: ProjectId): IntegrationManifestRecord[] {
    return this.db
      .all<DbRow>(
        'SELECT * FROM integration_manifests WHERE project_id = ? ORDER BY created_at DESC',
        [projectId],
      )
      .map(toIntegrationManifest)
  }

  createFeedbackRun(record: {
    readonly projectId: ProjectId
    readonly planId: PlanId
    readonly manifestId: string
    readonly report?: Record<string, unknown>
    readonly hash?: string
  }): FeedbackRunRecord {
    const id = createId('fbr')
    this.db.run(
      `INSERT INTO feedback_runs
        (id, project_id, plan_id, manifest_id, status, verdict, report_json, hash, created_at)
       VALUES (?, ?, ?, ?, 'RUNNING', NULL, ?, ?, ?)`,
      [
        id,
        record.projectId,
        record.planId,
        record.manifestId,
        JSON.stringify(redact(record.report ?? {})),
        record.hash ?? sha256('feedback-running'),
        nowIso(),
      ],
    )
    return this.getFeedbackRun(id)!
  }

  getFeedbackRun(id: string): FeedbackRunRecord | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM feedback_runs WHERE id = ?', [id])
    return row ? toFeedbackRun(row) : undefined
  }

  getFeedbackRunByManifest(manifestId: string): FeedbackRunRecord | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM feedback_runs WHERE manifest_id = ?', [
      manifestId,
    ])
    return row ? toFeedbackRun(row) : undefined
  }

  updateFeedbackRun(
    id: string,
    record: {
      readonly status: FeedbackRunRecord['status']
      readonly verdict?: FeedbackRunRecord['verdict']
      readonly report: Record<string, unknown>
      readonly hash: string
    },
  ): FeedbackRunRecord {
    const result = this.db.run(
      `UPDATE feedback_runs
       SET status = ?, verdict = ?, report_json = ?, hash = ?, completed_at = ?
       WHERE id = ?`,
      [
        record.status,
        record.verdict ?? null,
        JSON.stringify(redact(record.report)),
        record.hash,
        record.status === 'RUNNING' ? null : nowIso(),
        id,
      ],
    )
    if (result.changes === 0) throw new StoreConflictError(`Feedback run ${id} not found`)
    return this.getFeedbackRun(id)!
  }

  listFeedbackRuns(projectId: ProjectId): FeedbackRunRecord[] {
    return this.db
      .all<DbRow>('SELECT * FROM feedback_runs WHERE project_id = ? ORDER BY created_at DESC', [
        projectId,
      ])
      .map(toFeedbackRun)
  }

  createFinalDelivery(record: {
    readonly projectId: ProjectId
    readonly manifestId: string
    readonly feedbackId: string
    readonly summary: Record<string, unknown>
  }): FinalDeliveryRecord {
    const id = createId('fdl')
    this.db.run(
      `INSERT INTO final_deliveries
        (id, project_id, manifest_id, feedback_id, status, summary_json, created_at)
       VALUES (?, ?, ?, ?, 'READY', ?, ?)`,
      [
        id,
        record.projectId,
        record.manifestId,
        record.feedbackId,
        JSON.stringify(redact(record.summary)),
        nowIso(),
      ],
    )
    return this.getFinalDelivery(id)!
  }

  getFinalDelivery(id: string): FinalDeliveryRecord | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM final_deliveries WHERE id = ?', [id])
    return row ? toFinalDelivery(row) : undefined
  }

  getFinalDeliveryByManifest(manifestId: string): FinalDeliveryRecord | undefined {
    const row = this.db.get<DbRow>('SELECT * FROM final_deliveries WHERE manifest_id = ?', [
      manifestId,
    ])
    return row ? toFinalDelivery(row) : undefined
  }

  listFinalDeliveries(projectId: ProjectId): FinalDeliveryRecord[] {
    return this.db
      .all<DbRow>('SELECT * FROM final_deliveries WHERE project_id = ? ORDER BY created_at DESC', [
        projectId,
      ])
      .map(toFinalDelivery)
  }

  markFinalDeliveryDelivered(id: string): FinalDeliveryRecord {
    const result = this.db.run(
      `UPDATE final_deliveries SET status = 'DELIVERED', delivered_at = ? WHERE id = ?`,
      [nowIso(), id],
    )
    if (result.changes === 0) throw new StoreConflictError(`Final delivery ${id} not found`)
    return this.getFinalDelivery(id)!
  }

  countTable(table: string): number {
    if (!/^[a-z_]+$/.test(table)) throw new Error('Invalid table name')
    const row = this.db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
    return Number(row?.count ?? 0)
  }
}

export {
  toProject,
  toPlan,
  toAgent,
  toModule,
  toTask,
  toContract,
  toMessage,
  toReview,
  toApproval,
  toEvent,
  toIntegrationRun,
  toIntegrationManifest,
  toFeedbackRun,
  toFinalDelivery,
}

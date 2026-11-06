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
         attempt_count, max_attempts, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0)`,
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
}

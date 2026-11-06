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
} from '../domain/index.js'
import type {
  AgentId,
  ContractId,
  MessageId,
  ModuleId,
  ModuleVersionId,
  PlanId,
  ProjectId,
  TaskId,
} from '../domain/ids.js'
import { addSecondsIso, nowIso } from '../domain/id-factory.js'
import type { MessageKind } from '../domain/enums.js'
import {
  assertProjectTransition,
  canTransitionTask,
  InvalidTransitionError,
} from '../domain/transitions.js'
import type { AuthorizationService } from '../auth/authorization.js'
import type { Principal } from '../auth/types.js'
import type { SqliteStore } from '../persistence/store.js'
import { sha256 } from '../security/hash.js'
import { redact } from '../security/redaction.js'
import { ConflictError, NotFoundError, OrchestratorError, ValidationError } from './errors.js'

export interface CreateProjectInput {
  readonly name: string
  readonly repoPath: string
}

export interface CreatePlanInput {
  readonly projectId: ProjectId
  readonly title: string
  readonly spec: Record<string, unknown>
  readonly plan: Record<string, unknown>
}

export interface CreateTaskInput {
  readonly projectId: ProjectId
  readonly planId: PlanId
  readonly title: string
  readonly description: string
  readonly moduleId?: ModuleId
  readonly ownerAgentId?: AgentId
  readonly priority?: number
  readonly dependsOn?: readonly TaskId[]
}

export interface CreateModuleInput {
  readonly projectId: ProjectId
  readonly name: string
  readonly ownerAgentId: AgentId
  readonly pathScope: readonly string[]
}

export interface CreateModuleVersionInput {
  readonly moduleId: ModuleId
  readonly commitSha: string
  readonly treeHash: string
  readonly artifactHash: string
}

export interface CreateContractInput {
  readonly taskId: TaskId
  readonly moduleId: ModuleId
  readonly objective: string
  readonly allowedPaths: readonly string[]
  readonly inputInterfaces: readonly string[]
  readonly outputInterfaces: readonly string[]
  readonly acceptanceTests: readonly string[]
  readonly limits: Contract['limits']
  readonly deliveryFormat: string
}

export interface SubmitReviewInput {
  readonly moduleVersionId: ModuleVersionId
  readonly judgeRole: Review['judgeRole']
  readonly verdict: Review['verdict']
  readonly findings: Review['findings']
  readonly evidence: readonly string[]
}

export interface SendMessageInput {
  readonly projectId: ProjectId
  readonly toAgentId: AgentId
  readonly correlationId: string
  readonly kind: MessageKind
  readonly priority?: number
  readonly payload: Record<string, unknown>
  readonly idempotencyKey: string
}

export interface SendMessageResult {
  readonly message: Message
  readonly duplicate: boolean
}

export interface StateView {
  readonly project: Project
  readonly agents: readonly Agent[]
  readonly tasks: ReadonlyArray<Task & { dependencies: readonly TaskId[] }>
  readonly modules: ReadonlyArray<Module & { versions: readonly ModuleVersion[] }>
  readonly contracts: readonly Contract[]
  readonly reviews: readonly Review[]
  readonly approvals: readonly Approval[]
  readonly events: readonly Event[]
  readonly blockers: readonly string[]
  readonly generatedAt: string
}

const BOOTSTRAP_AGENTS: ReadonlyArray<{
  readonly opencodeAgentId: string
  readonly role: Agent['role']
  readonly name: string
}> = [
  { opencodeAgentId: 'padre', role: 'PARENT', name: 'Padre' },
  { opencodeAgentId: 'coordinador', role: 'COORDINATOR', name: 'Coordinador' },
  { opencodeAgentId: 'frontend', role: 'SPECIALIST', name: 'Especialista Frontend' },
  { opencodeAgentId: 'backend', role: 'SPECIALIST', name: 'Especialista Backend' },
  { opencodeAgentId: 'database', role: 'SPECIALIST', name: 'Especialista Database' },
  { opencodeAgentId: 'testing', role: 'JUDGE_TESTS', name: 'Juez de Pruebas' },
  { opencodeAgentId: 'debugger', role: 'JUDGE_DEBUG', name: 'Juez de Depuración' },
  { opencodeAgentId: 'architecture', role: 'JUDGE_ARCHITECTURE', name: 'Juez de Arquitectura' },
  { opencodeAgentId: 'optimizer', role: 'JUDGE_OPTIMIZATION', name: 'Juez de Optimización' },
  { opencodeAgentId: 'integrador', role: 'INTEGRATOR', name: 'Integrador' },
  { opencodeAgentId: 'feedback', role: 'FEEDBACK', name: 'Feedback' },
]

const MESSAGE_PRIORITY: Readonly<Record<MessageKind, number>> = {
  INFO: 10,
  QUERY: 30,
  ORDER: 60,
  PAUSE: 90,
  CANCEL: 100,
}

/**
 * Núcleo de la Fase 2. Las reglas de autorización, persistencia y transiciones
 * se aplican en código; el modelo no decide ninguna de ellas.
 */
export class OrchestratorService {
  constructor(
    private readonly store: SqliteStore,
    private readonly authz: AuthorizationService,
  ) {}

  createProject(principal: Principal, input: CreateProjectInput): Project {
    this.authz.require(principal, 'project.create', { type: 'project' })
    const name = input.name.trim()
    const repoPath = input.repoPath.trim()
    if (!name || !repoPath) throw new ValidationError('name and repoPath are required')

    const existing = this.store.getProjectByRepo(repoPath)
    if (existing) {
      if (existing.name !== name)
        throw new ConflictError('repoPath already belongs to another project')
      return existing
    }

    return this.store.transaction(() => {
      const project = this.store.createProject({ name, repoPath })
      this.emit(project.id, 'project.created', 'project', project.id, principal.subjectId, {
        name,
        repoPath,
      })
      return project
    })
  }

  listProjects(principal: Principal): Project[] {
    if (principal.kind === 'HUMAN') return this.store.listProjects()
    if (!principal.projectId) return []
    const project = this.store.getProject(principal.projectId as ProjectId)
    return project ? [project] : []
  }

  getProject(principal: Principal, projectId: ProjectId): Project {
    this.authz.require(principal, 'project.read', { type: 'project', id: projectId })
    const project = this.store.getProject(projectId)
    if (!project) throw new NotFoundError(`Project ${projectId} not found`)
    return project
  }

  bootstrapAgents(principal: Principal, projectId: ProjectId): Agent[] {
    this.authz.require(principal, 'agent.register', { type: 'project', id: projectId })
    const project = this.store.getProject(projectId)
    if (!project) throw new NotFoundError(`Project ${projectId} not found`)

    return this.store.transaction(() => {
      const agents: Agent[] = []
      for (const definition of BOOTSTRAP_AGENTS) {
        const existing = this.store.getAgentByOpenCodeId(projectId, definition.opencodeAgentId)
        if (existing) {
          agents.push(existing)
          continue
        }
        const agent = this.store.createAgent({
          projectId,
          role: definition.role,
          name: definition.name,
          opencodeAgentId: definition.opencodeAgentId,
          status: 'ACTIVE',
          capabilities: definition.role === 'SPECIALIST' ? ['edit:own-module', 'read'] : ['read'],
        })
        this.emit(projectId, 'agent.registered', 'agent', agent.id, principal.subjectId, {
          role: agent.role,
          opencodeAgentId: agent.opencodeAgentId,
        })
        agents.push(agent)
      }
      return agents
    })
  }

  createPlan(principal: Principal, input: CreatePlanInput): Plan {
    this.authz.require(principal, 'plan.propose', { type: 'project', id: input.projectId })
    const project = this.store.getProject(input.projectId)
    if (!project) throw new NotFoundError(`Project ${input.projectId} not found`)
    if (!['DRAFT', 'PLAN_PROPOSED', 'AWAITING_APPROVAL'].includes(project.status)) {
      throw new ConflictError(
        `Project ${project.id} is ${project.status}; cannot propose a new plan`,
      )
    }
    const plans = this.store.listPlans(input.projectId)
    const version = (plans[0]?.version ?? 0) + 1
    const hash = sha256({
      projectId: input.projectId,
      version,
      title: input.title,
      spec: input.spec,
      plan: input.plan,
    })
    const existing = this.store.getPlanByHash(input.projectId, hash)
    if (existing) return existing

    return this.store.transaction(() => {
      const plan = this.store.createPlan({
        projectId: input.projectId,
        version,
        title: input.title,
        status: 'PROPOSED',
        spec: input.spec,
        plan: input.plan,
        hash,
        proposedBy: principal.agentId as AgentId,
      })

      if (project.status === 'DRAFT') {
        assertProjectTransition('DRAFT', 'PLAN_PROPOSED')
        this.store.updateProjectStatus(project.id, 'PLAN_PROPOSED', project.version)
      }
      if (project.status === 'DRAFT' || project.status === 'PLAN_PROPOSED') {
        assertProjectTransition('PLAN_PROPOSED', 'AWAITING_APPROVAL')
        this.store.updateProjectStatus(project.id, 'AWAITING_APPROVAL')
      }

      this.emit(plan.projectId, 'plan.proposed', 'plan', plan.id, principal.subjectId, {
        planId: plan.id,
        version: plan.version,
        hash: plan.hash,
      })
      return plan
    })
  }

  approvePlan(principal: Principal, planId: PlanId, hash: string): Plan {
    this.authz.require(principal, 'plan.approve', { type: 'plan', id: planId })
    const plan = this.store.getPlan(planId)
    if (!plan) throw new NotFoundError(`Plan ${planId} not found`)
    if (plan.hash !== hash) throw new ConflictError('Plan hash does not match')
    if (plan.status === 'APPROVED') return plan
    if (plan.status !== 'PROPOSED') throw new ConflictError(`Plan ${planId} is ${plan.status}`)

    const project = this.store.getProject(plan.projectId)
    if (!project) throw new NotFoundError(`Project ${plan.projectId} not found`)
    if (project.status !== 'AWAITING_APPROVAL') {
      throw new ConflictError(`Project ${project.id} is ${project.status}; approval is not pending`)
    }

    return this.store.transaction(() => {
      const existing = this.store.findApproval(
        plan.projectId,
        'PLAN',
        plan.id,
        plan.hash,
        principal.subjectId,
      )
      if (existing) return plan

      assertProjectTransition('AWAITING_APPROVAL', 'APPROVED')
      this.store.updateProjectStatus(project.id, 'APPROVED', project.version)
      this.store.approvePlanRecord(plan.id, principal.subjectId)
      this.store.createApproval({
        projectId: plan.projectId,
        subjectType: 'PLAN',
        subjectId: plan.id,
        subjectHash: plan.hash,
        approverId: principal.subjectId,
        decision: 'APPROVED',
        reason: 'Human approval of the proposed plan',
      })
      this.emit(plan.projectId, 'plan.approved', 'plan', plan.id, principal.subjectId, {
        planId: plan.id,
        hash: plan.hash,
      })
      return this.store.getPlan(plan.id)!
    })
  }

  startProject(principal: Principal, projectId: ProjectId): Project {
    this.authz.require(principal, 'project.start', { type: 'project', id: projectId })
    const project = this.store.getProject(projectId)
    if (!project) throw new NotFoundError(`Project ${projectId} not found`)
    if (project.status !== 'APPROVED') throw new ConflictError(`Project is ${project.status}`)
    if (!this.store.listPlans(projectId).some((plan) => plan.status === 'APPROVED')) {
      throw new ValidationError('Project has no approved plan')
    }
    return this.transitionProject(principal, project, 'RUNNING', 'project.started')
  }

  pauseProject(principal: Principal, projectId: ProjectId): Project {
    this.authz.require(principal, 'project.pause', { type: 'project', id: projectId })
    const project = this.store.getProject(projectId)
    if (!project) throw new NotFoundError(`Project ${projectId} not found`)
    return this.transitionProject(principal, project, 'PAUSED', 'project.paused')
  }

  resumeProject(principal: Principal, projectId: ProjectId): Project {
    this.authz.require(principal, 'project.resume', { type: 'project', id: projectId })
    const project = this.store.getProject(projectId)
    if (!project) throw new NotFoundError(`Project ${projectId} not found`)
    return this.transitionProject(principal, project, 'RUNNING', 'project.resumed')
  }

  cancelProject(principal: Principal, projectId: ProjectId): Project {
    this.authz.require(principal, 'project.cancel', { type: 'project', id: projectId })
    const project = this.store.getProject(projectId)
    if (!project) throw new NotFoundError(`Project ${projectId} not found`)
    return this.transitionProject(principal, project, 'CANCELLED', 'project.cancelled')
  }

  createTask(principal: Principal, input: CreateTaskInput): Task {
    this.authz.require(principal, 'task.create', { type: 'project', id: input.projectId })
    const project = this.store.getProject(input.projectId)
    if (!project) throw new NotFoundError(`Project ${input.projectId} not found`)
    if (project.status !== 'RUNNING')
      throw new ConflictError(`Project is ${project.status}; executions require RUNNING`)
    const plan = this.store.getPlan(input.planId)
    if (!plan || plan.projectId !== input.projectId)
      throw new NotFoundError('Plan not found in project')
    if (plan.status !== 'APPROVED') throw new ValidationError('Tasks require an approved plan')
    if (input.moduleId) {
      const module = this.store.getModule(input.moduleId)
      if (!module || module.projectId !== input.projectId)
        throw new NotFoundError('Module not found')
    }
    if (input.ownerAgentId) this.assertAssignableAgent(input.projectId, input.ownerAgentId)
    if (input.priority !== undefined && (input.priority < 0 || input.priority > 100)) {
      throw new ValidationError('priority must be between 0 and 100')
    }

    const dependencies = input.dependsOn ?? []
    for (const dependency of dependencies) {
      const task = this.store.getTask(dependency)
      if (!task || task.projectId !== input.projectId)
        throw new ValidationError('Dependency not found')
    }

    return this.store.transaction(() => {
      const task = this.store.createTask({
        projectId: input.projectId,
        planId: input.planId,
        ...(input.moduleId ? { moduleId: input.moduleId } : {}),
        title: input.title,
        description: input.description,
        state: 'PENDING',
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.ownerAgentId ? { ownerAgentId: input.ownerAgentId } : {}),
      })
      for (const dependency of dependencies) {
        if (dependency === task.id) throw new ValidationError('Task cannot depend on itself')
        this.store.addTaskDependency(task.id, dependency)
      }
      this.assertAcyclic(input.projectId)
      this.emit(input.projectId, 'task.created', 'task', task.id, principal.subjectId, {
        taskId: task.id,
        dependencies,
        priority: task.priority,
      })
      return task
    })
  }

  assignTask(principal: Principal, taskId: TaskId, ownerAgentId: AgentId): Task {
    const current = this.store.getTask(taskId)
    if (!current) throw new NotFoundError(`Task ${taskId} not found`)
    const action = current.ownerAgentId ? 'task.reassign' : 'task.assign'
    this.authz.require(principal, action, { type: 'task', id: taskId })
    this.assertAssignableAgent(current.projectId, ownerAgentId)
    if (['APPROVED', 'INTEGRATED', 'CANCELLED', 'FAILED'].includes(current.state)) {
      throw new ConflictError(`Task ${taskId} is ${current.state}`)
    }

    return this.store.transaction(() => {
      let task = this.store.assignTask(taskId, ownerAgentId)
      if (task.state === 'PENDING') {
        task = this.store.updateTaskState(taskId, 'READY')
      }
      this.store.setAgentCurrentTask(ownerAgentId, taskId)
      this.emit(task.projectId, 'task.assigned', 'task', task.id, principal.subjectId, {
        ownerAgentId,
        state: task.state,
      })
      return task
    })
  }

  prioritizeTask(principal: Principal, taskId: TaskId, priority: number): Task {
    this.authz.require(principal, 'task.prioritize', { type: 'task', id: taskId })
    if (priority < 0 || priority > 100)
      throw new ValidationError('priority must be between 0 and 100')
    const task = this.store.getTask(taskId)
    if (!task) throw new NotFoundError(`Task ${taskId} not found`)
    return this.store.transaction(() => {
      const updated = this.store.setTaskPriority(taskId, priority)
      this.emit(task.projectId, 'task.prioritized', 'task', task.id, principal.subjectId, {
        priority,
      })
      return updated
    })
  }

  pauseTask(principal: Principal, taskId: TaskId): Task {
    this.authz.require(principal, 'task.pause', { type: 'task', id: taskId })
    const task = this.store.getTask(taskId)
    if (!task) throw new NotFoundError(`Task ${taskId} not found`)
    if (task.state === 'PAUSED') return task
    if (!canTransitionTask(task.state, 'PAUSED'))
      throw new ConflictError(`Cannot pause task in ${task.state}`)
    return this.store.transaction(() => {
      const updated = this.store.updateTaskState(taskId, 'PAUSED')
      this.emit(task.projectId, 'task.paused', 'task', task.id, principal.subjectId, {
        from: task.state,
        to: 'PAUSED',
      })
      return updated
    })
  }

  cancelTask(principal: Principal, taskId: TaskId): Task {
    this.authz.require(principal, 'task.cancel', { type: 'task', id: taskId })
    const task = this.store.getTask(taskId)
    if (!task) throw new NotFoundError(`Task ${taskId} not found`)
    if (task.state === 'CANCELLED') return task
    if (!canTransitionTask(task.state, 'CANCELLED'))
      throw new ConflictError(`Cannot cancel task in ${task.state}`)
    return this.store.transaction(() => {
      const updated = this.store.updateTaskState(taskId, 'CANCELLED')
      this.emit(task.projectId, 'task.cancelled', 'task', task.id, principal.subjectId, {
        from: task.state,
      })
      return updated
    })
  }

  createModule(principal: Principal, input: CreateModuleInput): Module {
    this.authz.require(principal, 'module.create', { type: 'project', id: input.projectId })
    const project = this.store.getProject(input.projectId)
    if (!project) throw new NotFoundError(`Project ${input.projectId} not found`)
    if (project.status !== 'RUNNING') throw new ConflictError(`Project is ${project.status}`)
    this.assertAssignableAgent(input.projectId, input.ownerAgentId)
    if (input.pathScope.length === 0) throw new ValidationError('pathScope cannot be empty')

    return this.store.transaction(() => {
      const module = this.store.createModule({
        projectId: input.projectId,
        name: input.name,
        ownerAgentId: input.ownerAgentId,
        pathScope: [...input.pathScope],
        status: 'DRAFT',
      })
      this.emit(input.projectId, 'module.created', 'module', module.id, principal.subjectId, {
        moduleId: module.id,
        ownerAgentId: module.ownerAgentId,
      })
      return module
    })
  }

  createModuleVersion(principal: Principal, input: CreateModuleVersionInput): ModuleVersion {
    this.authz.require(principal, 'module.version.create', { type: 'module', id: input.moduleId })
    const module = this.store.getModule(input.moduleId)
    if (!module) throw new NotFoundError(`Module ${input.moduleId} not found`)
    if (!/^[0-9a-f]{40}$/i.test(input.commitSha))
      throw new ValidationError('commitSha must be 40 hex chars')
    const versions = this.store.listModuleVersions(input.moduleId)
    const duplicate = versions.find((version) => version.artifactHash === input.artifactHash)
    if (duplicate) return duplicate
    const versionNumber = (versions[0]?.version ?? 0) + 1

    return this.store.transaction(() => {
      const version = this.store.createModuleVersion({
        moduleId: input.moduleId,
        version: versionNumber,
        commitSha: input.commitSha,
        treeHash: input.treeHash,
        artifactHash: input.artifactHash,
        status: 'IN_REVIEW',
      })
      this.store.setModuleCurrentVersion(module.id, version.id)
      this.store.updateModuleStatus(module.id, 'IN_REVIEW')
      this.emit(
        module.projectId,
        'module.version.created',
        'module_version',
        version.id,
        principal.subjectId,
        {
          moduleId: module.id,
          version: version.version,
          artifactHash: version.artifactHash,
        },
      )
      return version
    })
  }

  createContract(principal: Principal, input: CreateContractInput): Contract {
    const task = this.store.getTask(input.taskId)
    if (!task) throw new NotFoundError(`Task ${input.taskId} not found`)
    this.authz.require(principal, 'contract.create', { type: 'project', id: task.projectId })
    const module = this.store.getModule(input.moduleId)
    if (!module || module.projectId !== task.projectId) throw new NotFoundError('Module not found')
    const hash = sha256({
      taskId: input.taskId,
      moduleId: input.moduleId,
      objective: input.objective,
      allowedPaths: input.allowedPaths,
      inputInterfaces: input.inputInterfaces,
      outputInterfaces: input.outputInterfaces,
      acceptanceTests: input.acceptanceTests,
      limits: input.limits,
      deliveryFormat: input.deliveryFormat,
    })
    const existing = this.store
      .listContracts(task.projectId)
      .find((contract) => contract.hash === hash)
    if (existing) return existing
    const version =
      (this.store.listContracts(task.projectId).filter((c) => c.taskId === task.id).length ?? 0) + 1

    return this.store.transaction(() => {
      const contract = this.store.createContract({
        taskId: input.taskId,
        moduleId: input.moduleId,
        version,
        objective: input.objective,
        allowedPaths: [...input.allowedPaths],
        inputInterfaces: [...input.inputInterfaces],
        outputInterfaces: [...input.outputInterfaces],
        acceptanceTests: [...input.acceptanceTests],
        limits: input.limits,
        deliveryFormat: input.deliveryFormat,
        hash,
        status: 'ACTIVE',
      })
      this.store.setTaskContract(task.id, contract.id)
      this.emit(task.projectId, 'contract.created', 'contract', contract.id, principal.subjectId, {
        contractId: contract.id,
        taskId: task.id,
        version: contract.version,
        hash: contract.hash,
      })
      return contract
    })
  }

  submitReview(principal: Principal, input: SubmitReviewInput): Review {
    const version = this.store.getModuleVersion(input.moduleVersionId)
    if (!version) throw new NotFoundError(`Module version ${input.moduleVersionId} not found`)
    this.authz.require(principal, 'review.submit', {
      type: 'module_version',
      id: input.moduleVersionId,
      judgeRole: input.judgeRole,
    })
    const existing = this.store
      .listReviewsForVersion(input.moduleVersionId)
      .find((review) => review.judgeRole === input.judgeRole)
    if (existing) return existing

    const hash = sha256({
      moduleVersionId: input.moduleVersionId,
      judgeRole: input.judgeRole,
      verdict: input.verdict,
      findings: input.findings,
      evidence: input.evidence,
    })
    const module = this.store.getModule(version.moduleId)
    if (!module) throw new NotFoundError('Module not found')

    return this.store.transaction(() => {
      const review = this.store.createReview({
        projectId: module.projectId,
        moduleVersionId: input.moduleVersionId,
        judgeRole: input.judgeRole,
        verdict: input.verdict,
        findings: input.findings,
        evidence: [...input.evidence],
        hash,
      })
      this.emit(module.projectId, 'review.submitted', 'review', review.id, principal.subjectId, {
        reviewId: review.id,
        moduleVersionId: version.id,
        judgeRole: review.judgeRole,
        verdict: review.verdict,
      })
      return review
    })
  }

  recordApproval(
    principal: Principal,
    input: {
      readonly projectId: ProjectId
      readonly subjectType: Approval['subjectType']
      readonly subjectId: string
      readonly subjectHash: string
      readonly decision: Approval['decision']
      readonly reason?: string
    },
  ): Approval {
    if (input.subjectType === 'CONTRACT') {
      this.authz.require(principal, 'contract.approve', {
        type: 'contract',
        id: input.subjectId,
      })
    } else {
      this.authz.require(principal, 'approval.create', { type: 'project', id: input.projectId })
    }
    this.assertApprovalSubject(input)
    const existing = this.store.findApproval(
      input.projectId,
      input.subjectType,
      input.subjectId,
      input.subjectHash,
      principal.subjectId,
    )
    if (existing) return existing

    return this.store.transaction(() => {
      const approval = this.store.createApproval({
        projectId: input.projectId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        subjectHash: input.subjectHash,
        approverId: principal.subjectId,
        decision: input.decision,
        ...(input.reason ? { reason: input.reason } : {}),
      })
      this.emit(
        input.projectId,
        'approval.recorded',
        'approval',
        approval.id,
        principal.subjectId,
        {
          approvalId: approval.id,
          subjectType: approval.subjectType,
          subjectId: approval.subjectId,
          decision: approval.decision,
        },
      )
      return approval
    })
  }

  grantTemporaryPermission(
    principal: Principal,
    input: {
      readonly projectId: ProjectId
      readonly principalId: string
      readonly action: string
      readonly resource: string
      readonly effect: 'allow' | 'deny'
      readonly ttlSeconds: number
    },
  ): string {
    this.authz.require(principal, 'temporary_permission.grant', {
      type: 'project',
      id: input.projectId,
    })
    if (input.ttlSeconds <= 0) throw new ValidationError('ttlSeconds must be positive')
    return this.store.transaction(() => {
      const id = this.store.writeTemporaryPermission({
        projectId: input.projectId,
        principalId: input.principalId,
        action: input.action,
        resource: input.resource,
        effect: input.effect,
        expiresAt: addSecondsIso(input.ttlSeconds),
        grantedBy: principal.subjectId,
      })
      this.emit(
        input.projectId,
        'temporary_permission.granted',
        'temporary_permission',
        id,
        principal.subjectId,
        {
          principalId: input.principalId,
          action: input.action,
          effect: input.effect,
        },
      )
      return id
    })
  }

  sendMessage(principal: Principal, input: SendMessageInput): SendMessageResult {
    this.authz.require(principal, 'message.send', {
      type: 'message',
      projectId: input.projectId,
      targetAgentId: input.toAgentId,
      messageKind: input.kind,
    })
    if (principal.kind !== 'AGENT' || !principal.agentId) {
      throw new ValidationError('Only an authenticated agent can send messages')
    }
    const fromAgent = this.store.getAgent(principal.agentId as AgentId)
    const toAgent = this.store.getAgent(input.toAgentId)
    if (!fromAgent || fromAgent.projectId !== input.projectId)
      throw new NotFoundError('Sender not found')
    if (!toAgent || toAgent.projectId !== input.projectId)
      throw new NotFoundError('Recipient not found')
    if (!input.idempotencyKey.trim()) throw new ValidationError('idempotencyKey is required')
    const priority = input.priority ?? MESSAGE_PRIORITY[input.kind]
    if (priority < 0 || priority > 100)
      throw new ValidationError('priority must be between 0 and 100')

    const existing = this.store.getMessageByIdempotency(input.projectId, input.idempotencyKey)
    if (existing) {
      if (this.sameMessage(existing, input, fromAgent.id, priority)) {
        return { message: existing, duplicate: true }
      }
      throw new ConflictError('idempotencyKey was used for a different message')
    }

    return this.store.transaction(() => {
      const message = this.store.createMessage({
        projectId: input.projectId,
        fromAgentId: fromAgent.id,
        toAgentId: toAgent.id,
        correlationId: input.correlationId,
        kind: input.kind,
        priority,
        payload: input.payload,
        requiresApproval:
          input.kind === 'ORDER' || input.kind === 'PAUSE' || input.kind === 'CANCEL',
        ...(input.kind === 'ORDER' || input.kind === 'PAUSE' || input.kind === 'CANCEL'
          ? { approvedBy: principal.subjectId }
          : {}),
        idempotencyKey: input.idempotencyKey,
      })
      this.emit(input.projectId, 'message.sent', 'message', message.id, principal.subjectId, {
        messageId: message.id,
        kind: message.kind,
        fromAgentId: message.fromAgentId,
        toAgentId: message.toAgentId,
        correlationId: message.correlationId,
        priority: message.priority,
      })
      return { message, duplicate: false }
    })
  }

  listMessages(principal: Principal, projectId: ProjectId): Message[] {
    this.authz.require(principal, 'state.read', { type: 'project', id: projectId })
    if (principal.kind !== 'AGENT' || !principal.agentId) {
      throw new ValidationError('Messages are only accessible to their recipient agent')
    }
    return this.store.listMessages(projectId, principal.agentId as AgentId)
  }

  ackMessage(principal: Principal, messageId: MessageId): Message {
    this.authz.require(principal, 'message.ack', { type: 'message', id: messageId })
    const message = this.store.getMessage(messageId)
    if (!message) throw new NotFoundError(`Message ${messageId} not found`)
    if (message.state === 'ACKED') return message
    if (message.state === 'REJECTED' || message.state === 'EXPIRED') {
      throw new ConflictError(`Message is ${message.state}`)
    }
    return this.store.transaction(() => {
      const updated = this.store.updateMessageState(messageId, 'ACKED', { ackedAt: nowIso() })
      this.emit(message.projectId, 'message.acked', 'message', message.id, principal.subjectId, {
        messageId: message.id,
        correlationId: message.correlationId,
      })
      return updated
    })
  }

  deliverMessage(principal: Principal, messageId: MessageId, safePoint: boolean): Message {
    this.authz.require(principal, 'message.deliver', { type: 'message', id: messageId })
    const message = this.store.getMessage(messageId)
    if (!message) throw new NotFoundError(`Message ${messageId} not found`)
    if (message.state === 'DELIVERED' || message.state === 'ACKED') return message
    if (message.state !== 'QUEUED') throw new ConflictError(`Message is ${message.state}`)
    if ((message.kind === 'INFO' || message.kind === 'QUERY') && !safePoint) return message

    return this.store.transaction(() => {
      const updated = this.store.updateMessageState(messageId, 'DELIVERED', {
        deliveredAt: nowIso(),
      })
      this.emit(
        message.projectId,
        'message.delivered',
        'message',
        message.id,
        principal.subjectId,
        {
          messageId: message.id,
          kind: message.kind,
          safePoint,
        },
      )
      return updated
    })
  }

  getState(principal: Principal, projectId: ProjectId): StateView {
    this.authz.require(principal, 'state.read', { type: 'project', id: projectId })
    const project = this.store.getProject(projectId)
    if (!project) throw new NotFoundError(`Project ${projectId} not found`)
    const agents = this.store.listAgents(projectId)
    const tasks = this.store.listTasks(projectId)
    const dependencies = this.store.listDependenciesForProject(projectId)
    const modules = this.store.listModules(projectId)
    const contracts = this.store.listContracts(projectId)
    const reviews = this.store.listReviews(projectId)
    const approvals = this.store.listApprovals(projectId)
    const events = this.store.listEvents(projectId, 50)

    const dependencyMap = new Map<string, TaskId[]>()
    for (const dependency of dependencies) {
      const list = dependencyMap.get(dependency.taskId) ?? []
      list.push(dependency.dependsOnTaskId)
      dependencyMap.set(dependency.taskId, list)
    }

    const state: StateView = {
      project,
      agents,
      tasks: tasks.map((task) => ({
        ...task,
        dependencies: dependencyMap.get(task.id) ?? [],
      })),
      modules: modules.map((module) => ({
        ...module,
        versions: this.store.listModuleVersions(module.id),
      })),
      contracts,
      reviews,
      approvals,
      events,
      blockers: tasks
        .filter(
          (task) => task.state === 'BLOCKED' || task.state === 'FAILED' || task.state === 'PAUSED',
        )
        .map((task) => `${task.id}:${task.state}`),
      generatedAt: nowIso(),
    }
    return redact(state)
  }

  listPlans(principal: Principal, projectId: ProjectId): Plan[] {
    this.authz.require(principal, 'plan.read', { type: 'project', id: projectId })
    return this.store.listPlans(projectId)
  }

  listAgents(principal: Principal, projectId: ProjectId): Agent[] {
    this.authz.require(principal, 'agent.read', { type: 'project', id: projectId })
    return this.store.listAgents(projectId)
  }

  listTasks(principal: Principal, projectId: ProjectId): Task[] {
    this.authz.require(principal, 'task.read', { type: 'project', id: projectId })
    return this.store.listTasks(projectId)
  }

  listContracts(principal: Principal, projectId: ProjectId): Contract[] {
    this.authz.require(principal, 'contract.read', { type: 'project', id: projectId })
    return this.store.listContracts(projectId)
  }

  listModules(principal: Principal, projectId: ProjectId): Module[] {
    this.authz.require(principal, 'module.read', { type: 'project', id: projectId })
    return this.store.listModules(projectId)
  }

  listModuleVersions(principal: Principal, moduleId: ModuleId): ModuleVersion[] {
    this.authz.require(principal, 'module.read', { type: 'module', id: moduleId })
    return this.store.listModuleVersions(moduleId)
  }

  listReviews(principal: Principal, projectId: ProjectId): Review[] {
    this.authz.require(principal, 'review.read', { type: 'project', id: projectId })
    return this.store.listReviews(projectId)
  }

  listApprovals(principal: Principal, projectId: ProjectId): Approval[] {
    this.authz.require(principal, 'approval.read', { type: 'project', id: projectId })
    return this.store.listApprovals(projectId)
  }

  listEvents(principal: Principal, projectId: ProjectId, limit = 100): Event[] {
    this.authz.require(principal, 'event.read', { type: 'project', id: projectId })
    return this.store.listEvents(projectId, Math.min(Math.max(limit, 1), 500))
  }

  listAudit(principal: Principal, projectId: ProjectId, limit = 100): AuditEntry[] {
    this.authz.require(principal, 'audit.read', { type: 'project', id: projectId })
    return this.store.listAudit(projectId, undefined, Math.min(Math.max(limit, 1), 500))
  }

  listRejected(principal: Principal, projectId: ProjectId, limit = 100): AuditEntry[] {
    this.authz.require(principal, 'audit.read', { type: 'project', id: projectId })
    return this.store.listAudit(projectId, 'DENY', Math.min(Math.max(limit, 1), 500))
  }

  listOutbox(
    principal: Principal,
    projectId: ProjectId,
    status?: 'PENDING' | 'DELIVERING' | 'DELIVERED' | 'FAILED',
  ): Array<Record<string, unknown>> {
    this.authz.require(principal, 'outbox.read', { type: 'project', id: projectId })
    return this.store.listOutboxForProject(projectId, status).map((item) => redact(item))
  }

  listCheckpoints(principal: Principal, projectId: ProjectId, scope?: string): Checkpoint[] {
    this.authz.require(principal, 'checkpoint.read', { type: 'project', id: projectId })
    return this.store.listCheckpoints(projectId, scope)
  }

  recordCheckpoint(
    principal: Principal,
    projectId: ProjectId,
    scope: string,
    state: Record<string, unknown>,
  ): Checkpoint {
    this.authz.require(principal, 'checkpoint.write', { type: 'project', id: projectId })
    return this.store.transaction(() => {
      const checkpoint = this.store.createCheckpoint(projectId, scope, state, sha256(state))
      this.emit(projectId, 'checkpoint.created', 'checkpoint', checkpoint.id, principal.subjectId, {
        checkpointId: checkpoint.id,
        scope,
      })
      return checkpoint
    })
  }

  getAgent(principal: Principal, agentId: AgentId): Agent {
    const agent = this.store.getAgent(agentId)
    if (!agent) throw new NotFoundError(`Agent ${agentId} not found`)
    this.authz.require(principal, 'agent.read', { type: 'agent', id: agentId })
    return agent
  }

  getTask(principal: Principal, taskId: TaskId): Task {
    const task = this.store.getTask(taskId)
    if (!task) throw new NotFoundError(`Task ${taskId} not found`)
    this.authz.require(principal, 'task.read', { type: 'task', id: taskId })
    return task
  }

  private transitionProject(
    principal: Principal,
    project: Project,
    target: Project['status'],
    eventType: string,
  ): Project {
    if (project.status === target) return project
    try {
      assertProjectTransition(project.status, target)
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        throw new ConflictError(error.message)
      }
      throw error
    }
    return this.store.transaction(() => {
      const updated = this.store.updateProjectStatus(project.id, target, project.version)
      this.emit(project.id, eventType, 'project', project.id, principal.subjectId, {
        from: project.status,
        to: target,
      })
      return updated
    })
  }

  private emit(
    projectId: ProjectId,
    type: string,
    aggregateType: string,
    aggregateId: string,
    actorId: string,
    payload: Record<string, unknown>,
  ): Event {
    const event = this.store.appendEvent({
      projectId,
      type,
      aggregateType,
      aggregateId,
      actorId,
      payload,
    })
    this.store.appendOutbox(event.id, 'orchestrator.events', {
      eventId: event.id,
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
    })
    return event
  }

  private assertAssignableAgent(projectId: ProjectId, agentId: AgentId): Agent {
    const agent = this.store.getAgent(agentId)
    if (!agent || agent.projectId !== projectId)
      throw new NotFoundError(`Agent ${agentId} not found`)
    if (agent.status !== 'ACTIVE') throw new ConflictError(`Agent ${agentId} is ${agent.status}`)
    if (agent.role !== 'SPECIALIST' && agent.role !== 'INTEGRATOR') {
      throw new ValidationError(`Agent ${agentId} cannot own implementation tasks`)
    }
    return agent
  }

  private assertAcyclic(projectId: ProjectId): void {
    const dependencies = this.store.listDependenciesForProject(projectId)
    const graph = new Map<string, string[]>()
    for (const dependency of dependencies) {
      const list = graph.get(dependency.taskId) ?? []
      list.push(dependency.dependsOnTaskId)
      graph.set(dependency.taskId, list)
    }
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (node: string): void => {
      if (visiting.has(node)) throw new ValidationError('Task dependency graph contains a cycle')
      if (visited.has(node)) return
      visiting.add(node)
      for (const next of graph.get(node) ?? []) visit(next)
      visiting.delete(node)
      visited.add(node)
    }
    for (const node of graph.keys()) visit(node)
  }

  private sameMessage(
    existing: Message,
    input: SendMessageInput,
    fromAgentId: AgentId,
    priority: number,
  ): boolean {
    return (
      existing.fromAgentId === fromAgentId &&
      existing.toAgentId === input.toAgentId &&
      existing.correlationId === input.correlationId &&
      existing.kind === input.kind &&
      existing.priority === priority &&
      JSON.stringify(existing.payload) === JSON.stringify(redact(input.payload))
    )
  }

  private assertApprovalSubject(input: {
    readonly projectId: ProjectId
    readonly subjectType: Approval['subjectType']
    readonly subjectId: string
    readonly subjectHash: string
  }): void {
    if (input.subjectType === 'PLAN') {
      const plan = this.store.getPlan(input.subjectId as PlanId)
      if (!plan || plan.projectId !== input.projectId) throw new NotFoundError('Plan not found')
      if (plan.hash !== input.subjectHash) throw new ConflictError('Plan hash does not match')
    }
    if (input.subjectType === 'CONTRACT') {
      const contract = this.store.getContract(input.subjectId as ContractId)
      if (!contract || contract.hash !== input.subjectHash)
        throw new NotFoundError('Contract not found')
    }
    if (input.subjectType === 'MODULE') {
      const module = this.store.getModule(input.subjectId as ModuleId)
      if (!module || module.projectId !== input.projectId)
        throw new NotFoundError('Module not found')
    }
  }
}

export { OrchestratorError, ConflictError, NotFoundError, ValidationError }

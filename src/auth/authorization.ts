import type {
  Agent,
  Approval,
  Contract,
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
  ApprovalId,
  ContractId,
  MessageId,
  ModuleId,
  ModuleVersionId,
  PlanId,
  ProjectId,
  ReviewId,
  TaskId,
} from '../domain/ids.js'
import type { MessageKind } from '../domain/enums.js'
import type { SqliteStore } from '../persistence/store.js'
import type { Principal, PrincipalRole } from './types.js'
import { isJudgeRole, PrincipalSchema } from './types.js'

export type Action =
  | 'project.create'
  | 'project.read'
  | 'project.start'
  | 'project.pause'
  | 'project.resume'
  | 'project.cancel'
  | 'plan.propose'
  | 'plan.approve'
  | 'plan.read'
  | 'agent.register'
  | 'agent.read'
  | 'task.create'
  | 'task.read'
  | 'task.assign'
  | 'task.reassign'
  | 'task.prioritize'
  | 'task.pause'
  | 'task.cancel'
  | 'task.progress'
  | 'contract.create'
  | 'contract.approve'
  | 'contract.read'
  | 'module.create'
  | 'module.read'
  | 'module.write'
  | 'module.version.create'
  | 'module.version.read'
  | 'session.read'
  | 'session.create'
  | 'session.interrupt'
  | 'message.send'
  | 'message.read'
  | 'message.ack'
  | 'message.deliver'
  | 'review.submit'
  | 'review.read'
  | 'approval.create'
  | 'approval.read'
  | 'event.read'
  | 'state.read'
  | 'audit.read'
  | 'checkpoint.read'
  | 'checkpoint.write'
  | 'outbox.read'
  | 'temporary_permission.grant'
  | 'integration.run'
  | 'feedback.submit'

export type ResourceType =
  | 'project'
  | 'plan'
  | 'agent'
  | 'task'
  | 'module'
  | 'contract'
  | 'module_version'
  | 'message'
  | 'review'
  | 'approval'
  | 'event'
  | 'audit'
  | 'checkpoint'
  | 'session'
  | 'outbox'

export interface ResourceRef {
  readonly type: ResourceType
  readonly id?: string
  readonly projectId?: ProjectId
  readonly targetAgentId?: AgentId
  readonly messageKind?: MessageKind
  readonly judgeRole?: Review['judgeRole']
  readonly subjectHash?: string
}

export interface AuthorizationContext {
  readonly requestId?: string
}

export interface AuthorizationDecision {
  readonly allowed: boolean
  readonly action: Action
  readonly resource: string
  readonly reason: string
  readonly principal: Principal
}

export class AuthorizationError extends Error {
  readonly code = 'FORBIDDEN'
  readonly action: Action
  readonly resource: string
  readonly reason: string

  constructor(action: Action, resource: string, reason: string) {
    super(`Authorization denied for ${action} on ${resource}: ${reason}`)
    this.name = 'AuthorizationError'
    this.action = action
    this.resource = resource
    this.reason = reason
  }
}

const READ_ACTIONS = new Set<Action>([
  'project.read',
  'plan.read',
  'agent.read',
  'task.read',
  'contract.read',
  'module.read',
  'module.version.read',
  'session.read',
  'review.read',
  'approval.read',
  'event.read',
  'state.read',
  'audit.read',
  'checkpoint.read',
  'outbox.read',
])

const COORDINATOR_ACTIONS = new Set<Action>([
  'task.create',
  'task.assign',
  'task.reassign',
  'task.prioritize',
  'task.pause',
  'task.cancel',
  'contract.create',
  'contract.approve',
  'module.create',
  'checkpoint.write',
  'session.interrupt',
  'temporary_permission.grant',
])

const HUMAN_ACTIONS = new Set<Action>([
  'project.create',
  'project.start',
  'project.pause',
  'project.resume',
  'project.cancel',
  'plan.approve',
  'approval.create',
  'task.assign',
  'task.reassign',
  'task.prioritize',
  'task.pause',
  'task.cancel',
  'contract.approve',
  'checkpoint.write',
  'session.interrupt',
  'temporary_permission.grant',
])

const HUMAN_OR_COORDINATOR = new Set<Action>(['audit.read', 'checkpoint.read', 'outbox.read'])

function resourceKey(resource: ResourceRef): string {
  return `${resource.type}:${resource.id ?? '*'}:${resource.projectId ?? '*'}`
}

function effectiveRole(principal: Principal, agent: Agent | undefined): PrincipalRole {
  if (principal.kind === 'AGENT') {
    if (!agent) return principal.role
    return agent.role
  }
  return principal.role
}

/**
 * Política determinista. Ninguna instrucción en lenguaje natural participa en
 * la decisión: solo el principal autenticado, el recurso persistido, el rol
 * efectivo y concesiones temporales vigentes.
 */
export class AuthorizationService {
  constructor(private readonly store: SqliteStore) {}

  check(
    principal: Principal,
    action: Action,
    resource: ResourceRef,
    context: AuthorizationContext = {},
  ): AuthorizationDecision {
    const parsed = PrincipalSchema.safeParse(principal)
    if (!parsed.success) {
      return this.record(principal, action, resource, false, 'INVALID_PRINCIPAL', context)
    }

    const agent =
      principal.kind === 'AGENT' && principal.agentId
        ? this.store.getAgent(principal.agentId as AgentId)
        : undefined

    if (principal.kind === 'AGENT') {
      if (!agent) return this.record(principal, action, resource, false, 'AGENT_NOT_FOUND', context)
      if (agent.projectId !== principal.projectId) {
        return this.record(principal, action, resource, false, 'PROJECT_MISMATCH', context)
      }
      if (agent.role !== principal.role) {
        return this.record(principal, action, resource, false, 'ROLE_STALE', context)
      }
      if (!READ_ACTIONS.has(action) && agent.status !== 'ACTIVE') {
        return this.record(principal, action, resource, false, 'AGENT_NOT_ACTIVE', context)
      }
    }

    if (principal.kind === 'SYSTEM') {
      return this.record(
        principal,
        action,
        resource,
        false,
        'SYSTEM_PRINCIPAL_NOT_ALLOWED',
        context,
      )
    }

    if (action === 'project.create') {
      const decision = this.evaluate(principal, effectiveRole(principal, agent), action, resource, {
        projectId: (principal.projectId ?? '') as ProjectId,
      })
      return this.record(principal, action, resource, decision.allowed, decision.reason, context)
    }

    const resolved = this.resolve(resource)
    if (!resolved) {
      return this.record(
        principal,
        action,
        resource,
        false,
        'RESOURCE_NOT_FOUND',
        context,
        resource.projectId ?? principal.projectId,
      )
    }

    const projectResource: ResourceRef = { ...resource, projectId: resolved.projectId }
    const projectState = this.store.getProject(resolved.projectId)

    if (
      projectState &&
      !READ_ACTIONS.has(action) &&
      ['COMPLETED', 'FAILED', 'CANCELLED'].includes(projectState.status)
    ) {
      return this.record(
        principal,
        action,
        projectResource,
        false,
        'PROJECT_TERMINAL',
        context,
        resolved.projectId,
      )
    }

    if (
      principal.kind === 'HUMAN' &&
      principal.projectId &&
      resolved.projectId !== principal.projectId
    ) {
      return this.record(
        principal,
        action,
        projectResource,
        false,
        'PROJECT_MISMATCH',
        context,
        resolved.projectId,
      )
    }
    if (principal.kind === 'AGENT' && resolved.projectId !== principal.projectId) {
      return this.record(
        principal,
        action,
        projectResource,
        false,
        'PROJECT_MISMATCH',
        context,
        resolved.projectId,
      )
    }

    const role = effectiveRole(principal, agent)
    const projectId = resolved.projectId

    if (projectId) {
      const grants = this.store.listActiveTemporaryPermissions(
        projectId,
        principal.subjectId,
        action,
        resourceKey(projectResource),
      )
      if (grants.some((grant) => grant.effect === 'deny')) {
        return this.record(
          principal,
          action,
          projectResource,
          false,
          'TEMPORARY_PERMISSION_DENIED',
          context,
          projectId,
        )
      }
      if (grants.some((grant) => grant.effect === 'allow')) {
        return this.record(
          principal,
          action,
          projectResource,
          true,
          'TEMPORARY_PERMISSION_ALLOWED',
          context,
          projectId,
        )
      }
    }

    const decision = this.evaluate(principal, role, action, projectResource, resolved)
    return this.record(
      principal,
      action,
      projectResource,
      decision.allowed,
      decision.reason,
      context,
      projectId,
    )
  }

  require(
    principal: Principal,
    action: Action,
    resource: ResourceRef,
    context: AuthorizationContext = {},
  ): AuthorizationDecision {
    const decision = this.check(principal, action, resource, context)
    if (!decision.allowed) {
      throw new AuthorizationError(action, decision.resource, decision.reason)
    }
    return decision
  }

  private evaluate(
    principal: Principal,
    role: PrincipalRole,
    action: Action,
    resource: ResourceRef,
    resolved: ResolvedResource,
  ): { allowed: boolean; reason: string } {
    if (action === 'project.create') {
      return role === 'HUMAN'
        ? { allowed: true, reason: 'HUMAN_PROJECT_CREATE' }
        : { allowed: false, reason: 'ONLY_HUMAN_CAN_CREATE_PROJECT' }
    }

    if (READ_ACTIONS.has(action)) {
      if (action === 'audit.read' || action === 'checkpoint.read' || action === 'outbox.read') {
        if (role === 'HUMAN' || role === 'COORDINATOR') {
          return { allowed: true, reason: 'HUMAN_OR_COORDINATOR_READ' }
        }
        return { allowed: false, reason: 'HUMAN_OR_COORDINATOR_REQUIRED' }
      }
      return { allowed: true, reason: 'SHARED_OPERATIONAL_READ' }
    }

    if (HUMAN_ACTIONS.has(action)) {
      if (role === 'HUMAN') return { allowed: true, reason: 'HUMAN_AUTHORITY' }
      if (role === 'COORDINATOR' && COORDINATOR_ACTIONS.has(action)) {
        return { allowed: true, reason: 'COORDINATOR_AUTHORITY' }
      }
      if (HUMAN_OR_COORDINATOR.has(action) && role === 'COORDINATOR') {
        return { allowed: true, reason: 'COORDINATOR_AUTHORITY' }
      }
    }

    if (COORDINATOR_ACTIONS.has(action)) {
      return role === 'COORDINATOR'
        ? { allowed: true, reason: 'COORDINATOR_AUTHORITY' }
        : { allowed: false, reason: 'COORDINATOR_REQUIRED' }
    }

    switch (action) {
      case 'plan.propose':
        return role === 'PARENT'
          ? { allowed: true, reason: 'PARENT_PLAN_AUTHORITY' }
          : { allowed: false, reason: 'PARENT_REQUIRED' }

      case 'agent.register':
        return role === 'HUMAN'
          ? { allowed: true, reason: 'HUMAN_REGISTERS_AGENTS' }
          : { allowed: false, reason: 'HUMAN_REQUIRED' }

      case 'task.progress':
        return this.isTaskOwner(principal, resolved.task)
          ? { allowed: true, reason: 'TASK_OWNER' }
          : { allowed: false, reason: 'TASK_OWNER_REQUIRED' }

      case 'module.write':
        return this.isModuleOwner(principal, resolved.module)
          ? { allowed: true, reason: 'MODULE_OWNER' }
          : { allowed: false, reason: 'MODULE_OWNER_REQUIRED' }

      case 'module.version.create':
        return this.isModuleOwner(principal, resolved.module)
          ? { allowed: true, reason: 'MODULE_OWNER' }
          : { allowed: false, reason: 'MODULE_OWNER_REQUIRED' }

      case 'message.send': {
        if (principal.kind !== 'AGENT' || !principal.agentId) {
          return { allowed: false, reason: 'AGENT_SENDER_REQUIRED' }
        }
        if (!resolved.targetAgent || resolved.targetAgent.projectId !== resolved.projectId) {
          return { allowed: false, reason: 'TARGET_AGENT_NOT_FOUND' }
        }
        const kind = resource.messageKind ?? 'INFO'
        if (kind === 'ORDER' || kind === 'PAUSE' || kind === 'CANCEL') {
          return role === 'COORDINATOR' || role === 'HUMAN'
            ? { allowed: true, reason: 'AUTHORIZED_CONTROL_MESSAGE' }
            : { allowed: false, reason: 'COORDINATOR_REQUIRED_FOR_CONTROL_MESSAGE' }
        }
        return { allowed: true, reason: 'OPERATIONAL_MESSAGE' }
      }

      case 'message.read':
      case 'message.ack':
        return resolved.message && resolved.message.toAgentId === principal.agentId
          ? { allowed: true, reason: 'MESSAGE_RECIPIENT' }
          : { allowed: false, reason: 'MESSAGE_RECIPIENT_REQUIRED' }

      case 'message.deliver':
        return role === 'COORDINATOR' || role === 'HUMAN'
          ? { allowed: true, reason: 'DELIVERY_AUTHORITY' }
          : { allowed: false, reason: 'COORDINATOR_REQUIRED' }

      case 'review.submit':
        if (!isJudgeRole(role)) return { allowed: false, reason: 'JUDGE_REQUIRED' }
        return resource.judgeRole === role
          ? { allowed: true, reason: 'JUDGE_ROLE_MATCH' }
          : { allowed: false, reason: 'JUDGE_ROLE_MISMATCH' }

      case 'integration.run':
        return role === 'INTEGRATOR'
          ? { allowed: true, reason: 'INTEGRATOR_AUTHORITY' }
          : { allowed: false, reason: 'INTEGRATOR_REQUIRED' }

      case 'feedback.submit':
        return role === 'FEEDBACK'
          ? { allowed: true, reason: 'FEEDBACK_AUTHORITY' }
          : { allowed: false, reason: 'FEEDBACK_REQUIRED' }

      case 'temporary_permission.grant':
        return role === 'HUMAN' || role === 'COORDINATOR'
          ? { allowed: true, reason: 'HUMAN_OR_COORDINATOR_GRANT' }
          : { allowed: false, reason: 'HUMAN_OR_COORDINATOR_REQUIRED' }

      default:
        return { allowed: false, reason: 'DENY_BY_DEFAULT' }
    }
  }

  private resolve(resource: ResourceRef): ResolvedResource | undefined {
    switch (resource.type) {
      case 'project': {
        const project = resource.id ? this.store.getProject(resource.id as ProjectId) : undefined
        return project ? { projectId: project.id, project } : undefined
      }
      case 'plan': {
        const plan = resource.id ? this.store.getPlan(resource.id as PlanId) : undefined
        return plan ? { projectId: plan.projectId, plan } : undefined
      }
      case 'agent': {
        const agent = resource.id ? this.store.getAgent(resource.id as AgentId) : undefined
        return agent ? { projectId: agent.projectId, agent, targetAgent: agent } : undefined
      }
      case 'task': {
        const task = resource.id ? this.store.getTask(resource.id as TaskId) : undefined
        return task ? { projectId: task.projectId, task } : undefined
      }
      case 'module': {
        const module = resource.id ? this.store.getModule(resource.id as ModuleId) : undefined
        return module ? { projectId: module.projectId, module } : undefined
      }
      case 'contract': {
        const contract = resource.id ? this.store.getContract(resource.id as ContractId) : undefined
        if (!contract) return undefined
        const task = this.store.getTask(contract.taskId)
        return task ? { projectId: task.projectId, contract, task } : undefined
      }
      case 'module_version': {
        const version = resource.id
          ? this.store.getModuleVersion(resource.id as ModuleVersionId)
          : undefined
        if (!version) return undefined
        const module = this.store.getModule(version.moduleId)
        return module ? { projectId: module.projectId, moduleVersion: version, module } : undefined
      }
      case 'message': {
        if (!resource.id) {
          const targetAgent = resource.targetAgentId
            ? this.store.getAgent(resource.targetAgentId)
            : undefined
          return resource.projectId ? { projectId: resource.projectId, targetAgent } : undefined
        }
        const message = this.store.getMessage(resource.id as MessageId)
        if (!message) return undefined
        const targetAgent = this.store.getAgent(message.toAgentId)
        return { projectId: message.projectId, message, targetAgent }
      }
      case 'approval': {
        const approval = resource.id ? this.store.getApproval(resource.id as ApprovalId) : undefined
        return approval ? { projectId: approval.projectId, approval } : undefined
      }
      case 'review': {
        const review = resource.id ? this.store.getReview(resource.id as ReviewId) : undefined
        return review ? { projectId: review.projectId, review } : undefined
      }
      case 'session': {
        const session = resource.id ? this.store.getSession(resource.id) : undefined
        return session ? { projectId: session.projectId } : undefined
      }
      default:
        return resource.projectId ? { projectId: resource.projectId } : undefined
    }
  }

  private isTaskOwner(principal: Principal, task: Task | undefined): boolean {
    return (
      task !== undefined && principal.kind === 'AGENT' && task.ownerAgentId === principal.agentId
    )
  }

  private isModuleOwner(principal: Principal, module: Module | undefined): boolean {
    return (
      module !== undefined &&
      principal.kind === 'AGENT' &&
      module.ownerAgentId === principal.agentId
    )
  }

  private record(
    principal: Principal,
    action: Action,
    resource: ResourceRef,
    allowed: boolean,
    reason: string,
    context: AuthorizationContext,
    projectIdOverride?: string,
  ): AuthorizationDecision {
    const key = resourceKey(resource)
    const auditProjectId = (projectIdOverride ?? resource.projectId ?? principal.projectId) as
      ProjectId | undefined
    try {
      this.store.writeAudit({
        ...(auditProjectId ? { projectId: auditProjectId } : {}),
        actorId: principal.subjectId,
        action,
        resource: key,
        decision: allowed ? 'ALLOW' : 'DENY',
        reason,
        ...(context.requestId ? { requestId: context.requestId } : {}),
      })
    } catch {
      // La decisión no debe quedar oculta por un fallo de auditoría; el fallo
      // de la operación principal prevalecerá. La Fase 5 endurecerá esto.
    }
    return {
      allowed,
      action,
      resource: key,
      reason,
      principal: {
        subjectId: principal.subjectId,
        kind: principal.kind,
        role: principal.role,
        ...(principal.projectId ? { projectId: principal.projectId } : {}),
        ...(principal.agentId ? { agentId: principal.agentId } : {}),
      },
    }
  }
}

interface ResolvedResource {
  readonly projectId: ProjectId
  readonly project?: Project
  readonly plan?: Plan
  readonly agent?: Agent
  readonly targetAgent?: Agent
  readonly task?: Task
  readonly module?: Module
  readonly contract?: Contract
  readonly message?: Message
  readonly moduleVersion?: ModuleVersion
  readonly review?: Review
  readonly approval?: Approval
}

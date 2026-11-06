import type { AuthorizationService } from '../auth/authorization.js'
import type { Principal } from '../auth/types.js'
import type { Contract, Module, Task } from '../domain/index.js'
import type { ProjectId, TaskId } from '../domain/ids.js'
import { addSecondsIso } from '../domain/id-factory.js'
import type { SqliteStore } from '../persistence/store.js'
import { StoreConflictError } from '../persistence/store.js'
import type { TaskClaim, TaskExecutionResult } from './execution-types.js'
import type { TaskExecutor } from './task-executor.js'

export interface SchedulerOptions {
  readonly maxParallel: number
  readonly leaseSeconds: number
  readonly taskMaxAttempts: number
}

export class Scheduler {
  constructor(
    private readonly store: SqliteStore,
    private readonly authz: AuthorizationService,
    private readonly executor: TaskExecutor,
    private readonly options: SchedulerOptions,
  ) {}

  refreshReadyTasks(projectId: ProjectId, actorId: string): number {
    const project = this.store.getProject(projectId)
    if (!project || project.status !== 'RUNNING') return 0
    const tasks = this.store.listTasks(projectId)
    const dependencies = this.store.listDependenciesForProject(projectId)
    const byId = new Map(tasks.map((task) => [task.id, task]))
    const dependenciesByTask = new Map<string, string[]>()
    for (const dependency of dependencies) {
      const list = dependenciesByTask.get(dependency.taskId) ?? []
      list.push(dependency.dependsOnTaskId)
      dependenciesByTask.set(dependency.taskId, list)
    }

    let released = 0
    this.store.transaction(() => {
      for (const task of tasks) {
        if (task.state !== 'PENDING') continue
        const deps = dependenciesByTask.get(task.id) ?? []
        const states = deps.map((id) => byId.get(id as TaskId)?.state)
        if (states.some((state) => state === 'FAILED' || state === 'CANCELLED')) {
          this.store.updateTaskState(task.id, 'BLOCKED')
          this.emit(projectId, 'task.blocked', 'task', task.id, actorId, {
            reason: 'dependency_failed',
          })
          continue
        }
        if (states.every((state) => state === 'APPROVED' || state === 'INTEGRATED')) {
          this.store.updateTaskState(task.id, 'READY')
          this.emit(projectId, 'task.ready', 'task', task.id, actorId, {
            dependencies: deps,
          })
          released += 1
        }
      }
    })
    return released
  }

  claimReadyTasks(principal: Principal, projectId: ProjectId): TaskClaim[] {
    this.authz.require(principal, 'task.assign', { type: 'project', id: projectId })
    const project = this.store.getProject(projectId)
    if (!project || project.status !== 'RUNNING') return []
    if (!this.store.listPlans(projectId).some((plan) => plan.status === 'APPROVED')) return []

    this.recoverExpiredLeases(principal, projectId)
    this.refreshReadyTasks(projectId, principal.subjectId)
    const activeLeases = this.store.listActiveLeases()
    const slots = Math.max(0, this.options.maxParallel - activeLeases.length)
    if (slots === 0) return []

    const contracts = this.store.listContracts(projectId)
    const modules = new Map(this.store.listModules(projectId).map((module) => [module.id, module]))
    const tasks = this.store
      .listTasks(projectId)
      .filter((task) => task.state === 'READY')
      .sort((left, right) => right.priority - left.priority)

    const claims: TaskClaim[] = []
    for (const task of tasks) {
      if (claims.length >= slots) break
      if (task.attemptCount >= Math.min(task.maxAttempts, this.options.taskMaxAttempts)) {
        this.store.transaction(() => {
          this.store.updateTaskState(task.id, 'BLOCKED')
          this.emit(projectId, 'task.blocked', 'task', task.id, principal.subjectId, {
            reason: 'max_attempts',
          })
        })
        continue
      }
      const module = task.moduleId ? modules.get(task.moduleId) : undefined
      const ownerId = task.ownerAgentId ?? module?.ownerAgentId
      const agent = ownerId ? this.store.getAgent(ownerId) : undefined
      if (!agent || agent.status !== 'ACTIVE') continue
      const contract = this.findContract(task, contracts)
      if (!contract) continue
      if (this.store.getLease(task.id)) continue

      try {
        const claim = this.store.transaction(() => {
          const current = this.store.getTask(task.id)
          if (!current || current.state !== 'READY') return undefined
          const withAttempt = this.store.incrementTaskAttempt(task.id)
          const running = this.store.updateTaskState(task.id, 'RUNNING', withAttempt.version)
          const attempt = withAttempt.attemptCount
          const lease = this.store.createLease({
            taskId: task.id,
            ownerId: principal.subjectId,
            attempt,
            expiresAt: addSecondsIso(this.options.leaseSeconds),
          })
          const taskAttempt = this.store.createTaskAttempt({
            taskId: task.id,
            attempt,
            status: 'RUNNING',
          })
          this.store.setTaskLease(task.id, lease.expiresAt)
          this.store.setAgentCurrentTask(agent.id, task.id)
          this.emit(projectId, 'task.claimed', 'task', task.id, principal.subjectId, {
            taskId: task.id,
            agentId: agent.id,
            attempt,
            leaseExpiresAt: lease.expiresAt,
          })
          return {
            task: running,
            agent,
            contract,
            ...(module ? { module: module as Module } : {}),
            attempt: taskAttempt,
          } satisfies TaskClaim
        })
        if (claim) claims.push(claim)
      } catch (error) {
        if (!(error instanceof StoreConflictError)) throw error
      }
    }
    return claims
  }

  async runOnce(principal: Principal, projectId: ProjectId): Promise<TaskExecutionResult[]> {
    const claims = this.claimReadyTasks(principal, projectId)
    if (claims.length === 0) return []
    const settled = await Promise.allSettled(claims.map((claim) => this.executor.execute(claim)))
    return settled.map((result, index) => {
      if (result.status === 'fulfilled') return result.value
      const claim = claims[index]!
      return {
        taskId: claim.task.id,
        status: 'FAILED',
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      }
    })
  }

  recoverExpiredLeases(principal: Principal, projectId: ProjectId): number {
    this.authz.require(principal, 'task.assign', { type: 'project', id: projectId })
    let recovered = 0
    this.store.transaction(() => {
      for (const lease of this.store.listExpiredLeases()) {
        const task = this.store.getTask(lease.taskId as TaskId)
        if (!task || task.projectId !== projectId || task.state !== 'RUNNING') continue
        const canRetry =
          task.attemptCount < Math.min(task.maxAttempts, this.options.taskMaxAttempts)
        this.store.updateTaskState(task.id, canRetry ? 'REWORK_REQUIRED' : 'FAILED')
        if (canRetry) this.store.updateTaskState(task.id, 'READY')
        this.store.deleteLease(task.id)
        this.store.setTaskLease(task.id, null)
        this.emit(projectId, 'task.lease_recovered', 'task', task.id, principal.subjectId, {
          canRetry,
        })
        recovered += 1
      }
    })
    return recovered
  }

  private findContract(task: Task, contracts: readonly Contract[]): Contract | undefined {
    if (task.contractId) {
      const byId = this.store.getContract(task.contractId)
      if (byId?.status === 'ACTIVE') return byId
    }
    return contracts.find((contract) => contract.taskId === task.id && contract.status === 'ACTIVE')
  }

  private emit(
    projectId: ProjectId,
    type: string,
    aggregateType: string,
    aggregateId: string,
    actorId: string,
    payload: Record<string, unknown>,
  ): void {
    const event = this.store.appendEvent({
      projectId,
      type,
      aggregateType,
      aggregateId,
      actorId,
      payload,
    })
    this.store.appendOutbox(event.id, 'orchestrator.scheduler', {
      eventId: event.id,
      type: event.type,
      aggregateId: event.aggregateId,
    })
  }
}

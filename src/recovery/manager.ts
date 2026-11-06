import { existsSync } from 'node:fs'
import type { Project, Task } from '../domain/index.js'
import type { ProjectId, TaskId } from '../domain/ids.js'
import { canTransitionProject } from '../domain/transitions.js'
import { sha256 } from '../security/hash.js'
import type { AuthorizationService } from '../auth/authorization.js'
import type { Principal } from '../auth/types.js'
import type {
  RecoveryActionRecord,
  RecoveryRunRecord,
  SessionRecord,
  SqliteStore,
  WorktreeRecord,
} from '../persistence/store.js'
import type { WorktreeManager } from '../worktrees/manager.js'
import type { SessionView } from '../opencode/adapter.js'
import { ConflictError, NotFoundError } from '../orchestrator/errors.js'
import { OperationService } from '../operations/service.js'
import type { ResourceGovernor } from '../resources/governor.js'

export interface RecoveryManagerOptions {
  readonly staleMinutes: number
  readonly taskMaxAttempts: number
  readonly leaseSeconds: number
  readonly operationLeaseSeconds: number
}

export interface RecoveryRunOptions {
  readonly apply: boolean
  readonly now?: string
}

export interface SessionInspector {
  getSession(sessionID: string): Promise<SessionView | null>
}

export interface RecoveryFinding {
  readonly code: string
  readonly entityType: string
  readonly entityId?: string
  readonly severity: 'INFO' | 'WARNING' | 'CRITICAL'
  readonly message: string
  readonly requiresHuman: boolean
  readonly detail: Record<string, unknown>
}

export interface RecoveryResult {
  readonly run: RecoveryRunRecord
  readonly actions: readonly RecoveryActionRecord[]
  readonly findings: readonly RecoveryFinding[]
  readonly applied: number
  readonly reused: boolean
}

interface FindingWithApply extends RecoveryFinding {
  readonly apply?: () => void
}

export class RecoveryManager {
  private readonly operations: OperationService

  constructor(
    private readonly store: SqliteStore,
    private readonly authz: AuthorizationService,
    private readonly worktrees: WorktreeManager,
    private readonly options: RecoveryManagerOptions,
    private readonly inspector?: SessionInspector,
    private readonly resources?: ResourceGovernor,
  ) {
    this.operations = new OperationService(store)
  }

  async run(
    principal: Principal,
    projectId: ProjectId,
    options: RecoveryRunOptions,
  ): Promise<RecoveryResult> {
    this.authz.require(principal, 'recovery.run', { type: 'project', id: projectId })
    const project = this.store.getProject(projectId)
    if (!project) throw new NotFoundError(`Project ${projectId} not found`)
    const mode = options.apply ? 'APPLY' : 'DRY_RUN'
    const stateHash = this.stateHash(projectId)
    const operation = this.store.getOperationByKey(
      projectId,
      'recovery',
      `recovery:${mode}:${stateHash}`,
    )
    if (operation?.status === 'RUNNING' && operation.leaseExpiresAt > new Date().toISOString()) {
      throw new ConflictError(`A recovery run is already active for ${projectId}`)
    }

    const result = await this.operations.run(
      {
        projectId,
        kind: 'recovery',
        idempotencyKey: `recovery:${mode}:${stateHash}`,
        inputHash: stateHash,
        leaseSeconds: this.options.operationLeaseSeconds,
      },
      async () => {
        const run = await this.perform(principal, project, options)
        return {
          runId: run.run.id,
          findingsCount: run.findings.length,
          appliedCount: run.applied,
        }
      },
    )

    const storedRun = this.store.getRecoveryRun(String(result.value['runId']))
    if (!storedRun) throw new Error('Recovery run disappeared')
    return {
      run: storedRun,
      actions: this.store.listRecoveryActions(storedRun.id),
      findings: [],
      applied: storedRun.appliedCount,
      reused: result.reused,
    }
  }

  async inspect(
    principal: Principal,
    projectId: ProjectId,
    options: { readonly now?: string } = {},
  ): Promise<RecoveryFinding[]> {
    this.authz.require(principal, 'recovery.read', { type: 'project', id: projectId })
    const project = this.store.getProject(projectId)
    if (!project) throw new NotFoundError(`Project ${projectId} not found`)
    const findings: FindingWithApply[] = []
    const now = options.now ? Date.parse(options.now) : Date.now()
    await this.collectSessions(project, now, findings)
    this.collectLeases(project, now, findings)
    this.collectTasks(project, findings)
    this.collectWorktrees(project, findings)
    this.collectJury(project, now, findings)
    this.collectIntegrations(project, findings)
    this.collectFeedback(project, findings)
    this.collectMessagesAndOutbox(project, findings)
    this.collectOperations(project, findings)
    this.collectApprovals(project, findings)
    this.collectResources(project, findings)
    this.collectProjectStage(project, findings)
    return findings
  }

  private async perform(
    principal: Principal,
    project: Project,
    options: RecoveryRunOptions,
  ): Promise<RecoveryResult> {
    const run = this.store.createRecoveryRun({
      projectId: project.id,
      mode: options.apply ? 'APPLY' : 'DRY_RUN',
    })
    const findings: FindingWithApply[] = []
    try {
      const now = options.now ? Date.parse(options.now) : Date.now()
      await this.collectSessions(project, now, findings)
      this.collectLeases(project, now, findings)
      this.collectTasks(project, findings)
      this.collectWorktrees(project, findings)
      this.collectJury(project, now, findings)
      this.collectIntegrations(project, findings)
      this.collectFeedback(project, findings)
      this.collectMessagesAndOutbox(project, findings)
      this.collectOperations(project, findings)
      this.collectApprovals(project, findings)
      this.collectResources(project, findings)
      this.collectProjectStage(project, findings)

      let applied = 0
      for (const finding of findings) {
        let status: RecoveryActionRecord['status'] = 'REQUIRED'
        if (options.apply && finding.apply) {
          try {
            this.store.transaction(() => finding.apply!())
            status = 'APPLIED'
            applied += 1
          } catch {
            status = 'FAILED'
          }
        } else if (options.apply && !finding.requiresHuman) {
          status = 'SKIPPED'
        }
        this.store.createRecoveryAction({
          recoveryRunId: run.id,
          code: finding.code,
          entityType: finding.entityType,
          ...(finding.entityId ? { entityId: finding.entityId } : {}),
          status,
          detail: {
            severity: finding.severity,
            message: finding.message,
            requiresHuman: finding.requiresHuman,
            ...finding.detail,
          },
        })
      }

      const summary = {
        projectId: project.id,
        mode: options.apply ? 'APPLY' : 'DRY_RUN',
        findings: findings.length,
        applied,
        requiresHuman: findings.filter((finding) => finding.requiresHuman).length,
        codes: [...new Set(findings.map((finding) => finding.code))],
      }
      const updated = this.store.updateRecoveryRun(run.id, {
        status: 'COMPLETED',
        findingsCount: findings.length,
        appliedCount: applied,
        summary,
      })
      this.emit(project.id, 'recovery.completed', 'recovery_run', run.id, principal.subjectId, {
        runId: run.id,
        mode: updated.mode,
        findings: findings.length,
        applied,
      })
      this.notifyParent(project, updated, findings)
      return {
        run: updated,
        actions: this.store.listRecoveryActions(run.id),
        findings,
        applied,
        reused: false,
      }
    } catch (error) {
      this.store.updateRecoveryRun(run.id, {
        status: 'FAILED',
        error: error instanceof Error ? error.message : String(error),
        summary: { findings: findings.length },
      })
      throw error
    }
  }

  private async collectSessions(
    project: Project,
    now: number,
    findings: FindingWithApply[],
  ): Promise<void> {
    for (const session of this.store.listSessions(project.id)) {
      if (session.status === 'STOPPED' || session.status === 'FAILED') continue
      const stale = now - Date.parse(session.updatedAt) > this.options.staleMinutes * 60_000
      if (!session.opencodeSessionId) {
        findings.push({
          code: 'SESSION_WITHOUT_OPENCODE_ID',
          entityType: 'session',
          entityId: session.id,
          severity: 'WARNING',
          message: `Session ${session.id} has no OpenCode session id`,
          requiresHuman: false,
          detail: { status: session.status },
          ...(session.status === 'ACTIVE' || session.status === 'STARTING'
            ? { apply: () => this.markSession(session, 'STOPPED', project.id) }
            : {}),
        })
        continue
      }
      if (!this.inspector) {
        if (stale && (session.status === 'ACTIVE' || session.status === 'STARTING')) {
          findings.push({
            code: 'SESSION_STALE',
            entityType: 'session',
            entityId: session.id,
            severity: 'WARNING',
            message: `Session ${session.id} appears stale but no inspector is available`,
            requiresHuman: true,
            detail: { status: session.status, updatedAt: session.updatedAt },
          })
        }
        continue
      }
      let view: SessionView | null = null
      try {
        view = await this.inspector.getSession(session.opencodeSessionId)
      } catch {
        view = null
      }
      if (!view) {
        findings.push({
          code: 'SESSION_MISSING_IN_OPENCODE',
          entityType: 'session',
          entityId: session.id,
          severity: 'WARNING',
          message: `OpenCode session ${session.opencodeSessionId} no longer exists`,
          requiresHuman: false,
          detail: { status: session.status },
          apply: () => this.markSession(session, 'STOPPED', project.id),
        })
        continue
      }
      if (view.outcome === 'failed') {
        findings.push({
          code: 'SESSION_FAILED',
          entityType: 'session',
          entityId: session.id,
          severity: 'WARNING',
          message: `OpenCode session ${session.opencodeSessionId} failed`,
          requiresHuman: false,
          detail: { status: session.status },
          apply: () => this.markSession(session, 'FAILED', project.id),
        })
        continue
      }
      if (stale && (session.status === 'ACTIVE' || session.status === 'STARTING')) {
        findings.push({
          code: 'SESSION_STALE',
          entityType: 'session',
          entityId: session.id,
          severity: 'WARNING',
          message: `Session ${session.id} was left active after a restart`,
          requiresHuman: false,
          detail: { status: session.status, updatedAt: session.updatedAt },
          apply: () =>
            this.markSession(
              session,
              view?.outcome === 'succeeded' ? 'IDLE' : 'STOPPED',
              project.id,
            ),
        })
      }
    }
  }

  private markSession(
    session: SessionRecord,
    status: SessionRecord['status'],
    projectId: ProjectId,
  ) {
    this.store.updateSessionStatus(session.id, status)
    this.emit(projectId, 'session.recovered', 'session', session.id, 'recovery', {
      sessionId: session.id,
      status,
    })
  }

  private collectLeases(project: Project, now: number, findings: FindingWithApply[]): void {
    const tasks = new Map(this.store.listTasks(project.id).map((task) => [task.id, task]))
    for (const lease of this.store.listExpiredLeases()) {
      const task = tasks.get(lease.taskId)
      if (!task) continue
      findings.push({
        code: task.state === 'RUNNING' ? 'LEASE_EXPIRED' : 'STALE_LEASE',
        entityType: 'task',
        entityId: task.id,
        severity: 'WARNING',
        message: `Lease for task ${task.id} expired`,
        requiresHuman: false,
        detail: {
          state: task.state,
          attempt: lease.attempt,
          expiresAt: lease.expiresAt,
          now: new Date(now).toISOString(),
        },
        apply: () => this.releaseStaleLease(task),
      })
    }
  }

  private releaseStaleLease(task: Task): void {
    const lease = this.store.getLease(task.id)
    if (!lease) return
    if (task.state === 'RUNNING') {
      this.recoverRunningTask(task)
    }
    this.store.deleteLease(task.id)
    this.store.setTaskLease(task.id, null)
    this.emit(task.projectId, 'task.lease_recovered', 'task', task.id, 'recovery', {
      taskId: task.id,
    })
  }

  private recoverRunningTask(task: Task): void {
    const runningAttempts = this.store
      .listTaskAttempts(task.id)
      .filter((attempt) => attempt.status === 'RUNNING')
    for (const attempt of runningAttempts) {
      this.store.updateTaskAttempt(attempt.id, 'INTERRUPTED', {
        error: 'Orchestrator restart or expired lease',
      })
    }
    const canRetry = task.attemptCount < Math.min(task.maxAttempts, this.options.taskMaxAttempts)
    if (canRetry) {
      this.store.updateTaskState(task.id, 'REWORK_REQUIRED')
      this.store.updateTaskState(task.id, 'READY')
    } else {
      this.store.updateTaskState(task.id, 'FAILED')
    }
    if (task.ownerAgentId) this.store.setAgentCurrentTask(task.ownerAgentId, null)
    this.emit(task.projectId, 'task.recovered', 'task', task.id, 'recovery', {
      taskId: task.id,
      retry: canRetry,
      previousState: task.state,
    })
  }

  private collectTasks(project: Project, findings: FindingWithApply[]): void {
    const tasks = this.store.listTasks(project.id)
    const dependencies = this.store.listDependenciesForProject(project.id)
    const byId = new Map(tasks.map((task) => [task.id, task]))
    const depsByTask = new Map<string, string[]>()
    for (const dependency of dependencies) {
      const list = depsByTask.get(dependency.taskId) ?? []
      list.push(dependency.dependsOnTaskId)
      depsByTask.set(dependency.taskId, list)
    }
    for (const task of tasks) {
      if (task.state === 'RUNNING' && !this.store.getLease(task.id)) {
        findings.push({
          code: 'TASK_ABANDONED',
          entityType: 'task',
          entityId: task.id,
          severity: 'WARNING',
          message: `Task ${task.id} is RUNNING without a lease`,
          requiresHuman: false,
          detail: { taskId: task.id, attemptCount: task.attemptCount },
          apply: () => this.recoverRunningTask(task),
        })
      }
      if (task.state === 'PENDING') {
        const states = (depsByTask.get(task.id) ?? []).map((id) => byId.get(id as TaskId)?.state)
        if (states.every((state) => state === 'APPROVED' || state === 'INTEGRATED')) {
          findings.push({
            code: 'TASK_READY_TO_RELEASE',
            entityType: 'task',
            entityId: task.id,
            severity: 'INFO',
            message: `Task ${task.id} can be released to READY`,
            requiresHuman: false,
            detail: { dependencies: depsByTask.get(task.id) ?? [] },
            apply: () => {
              this.store.updateTaskState(task.id, 'READY')
              this.emit(task.projectId, 'recovery.task_ready', 'task', task.id, 'recovery', {
                taskId: task.id,
              })
            },
          })
        }
      }
      if (task.state === 'IN_REVIEW' && task.moduleId) {
        const module = this.store.getModule(task.moduleId)
        if (!module?.currentVersionId) {
          findings.push({
            code: 'TASK_IN_REVIEW_WITHOUT_VERSION',
            entityType: 'task',
            entityId: task.id,
            severity: 'CRITICAL',
            message: `Task ${task.id} is IN_REVIEW without a module version`,
            requiresHuman: true,
            detail: { moduleId: task.moduleId },
          })
        }
      }
      if (task.state === 'APPROVED' && task.moduleId) {
        const module = this.store.getModule(task.moduleId)
        const version = module?.currentVersionId
          ? this.store.getModuleVersion(module.currentVersionId)
          : undefined
        if (!version || !this.store.getApprovedModuleByVersion(version.id)) {
          findings.push({
            code: 'TASK_APPROVED_WITHOUT_REGISTRY',
            entityType: 'task',
            entityId: task.id,
            severity: 'CRITICAL',
            message: `Task ${task.id} is APPROVED without an approved module version`,
            requiresHuman: true,
            detail: { moduleId: task.moduleId, versionId: version?.id ?? null },
          })
        }
      }
      if (task.state === 'REWORK_REQUIRED' && task.moduleId) {
        const superseding = tasks.find(
          (candidate) =>
            candidate.moduleId === task.moduleId &&
            candidate.id !== task.id &&
            candidate.reviewCycle > task.reviewCycle &&
            (candidate.state === 'APPROVED' || candidate.state === 'INTEGRATED'),
        )
        if (superseding) {
          findings.push({
            code: 'TASK_SUPERSEDED_REWORK',
            entityType: 'task',
            entityId: task.id,
            severity: 'INFO',
            message: `Task ${task.id} was superseded by ${superseding.id}`,
            requiresHuman: false,
            detail: { supersededBy: superseding.id, moduleId: task.moduleId },
            apply: () => {
              this.store.updateTaskState(task.id, 'CANCELLED')
              this.emit(task.projectId, 'recovery.task_superseded', 'task', task.id, 'recovery', {
                taskId: task.id,
                supersededBy: superseding.id,
              })
            },
          })
        }
      }
      if (task.state === 'BLOCKED' || task.state === 'FAILED' || task.state === 'PAUSED') {
        findings.push({
          code: 'TASK_NEEDS_ATTENTION',
          entityType: 'task',
          entityId: task.id,
          severity: 'WARNING',
          message: `Task ${task.id} is ${task.state}`,
          requiresHuman: true,
          detail: { state: task.state, attemptCount: task.attemptCount },
        })
      }
    }
  }

  private collectWorktrees(project: Project, findings: FindingWithApply[]): void {
    const tasks = new Map(this.store.listTasks(project.id).map((task) => [task.id, task]))
    for (const worktree of this.store.listWorktrees(project.id)) {
      if (worktree.status === 'REMOVED') continue
      const task = tasks.get(worktree.taskId)
      if (!existsSync(worktree.path)) {
        findings.push({
          code: 'WORKTREE_MISSING',
          entityType: 'worktree',
          entityId: worktree.id,
          severity: 'WARNING',
          message: `Worktree path is missing: ${worktree.path}`,
          requiresHuman: false,
          detail: { taskId: worktree.taskId, status: worktree.status },
          apply: () =>
            this.updateWorktree(worktree, task?.state === 'RUNNING' ? 'FAILED' : 'REMOVED'),
        })
        continue
      }
      let dirty: string[]
      try {
        dirty = this.worktrees.changedPaths(worktree.path)
      } catch (error) {
        findings.push({
          code: 'WORKTREE_UNREADABLE',
          entityType: 'worktree',
          entityId: worktree.id,
          severity: 'WARNING',
          message: `Cannot inspect worktree ${worktree.path}`,
          requiresHuman: true,
          detail: {
            taskId: worktree.taskId,
            error: error instanceof Error ? error.message : String(error),
          },
        })
        continue
      }
      if (dirty.length > 0) {
        findings.push({
          code: 'WORKTREE_DIRTY',
          entityType: 'worktree',
          entityId: worktree.id,
          severity: 'CRITICAL',
          message: `Worktree ${worktree.path} has uncommitted changes`,
          requiresHuman: true,
          detail: { paths: dirty.slice(0, 20), taskId: worktree.taskId },
        })
      } else if (worktree.status === 'ACTIVE' && task && task.state !== 'RUNNING') {
        findings.push({
          code: 'WORKTREE_ABANDONED',
          entityType: 'worktree',
          entityId: worktree.id,
          severity: 'WARNING',
          message: `Worktree ${worktree.path} is ACTIVE but its task is ${task.state}`,
          requiresHuman: false,
          detail: { taskId: worktree.taskId },
          apply: () => this.updateWorktree(worktree, 'FAILED'),
        })
      }
    }
  }

  private updateWorktree(worktree: WorktreeRecord, status: WorktreeRecord['status']): void {
    this.store.updateWorktreeStatus(worktree.id, status)
    this.emit(
      worktree.taskId ? this.taskProject(worktree.taskId) : undefined,
      'worktree.recovered',
      'worktree',
      worktree.id,
      'recovery',
      {
        status,
      },
    )
  }

  private taskProject(taskId: TaskId): ProjectId | undefined {
    return this.store.getTask(taskId)?.projectId
  }

  private collectJury(project: Project, now: number, findings: FindingWithApply[]): void {
    const activeJudgeSessions = this.store.listSessions(project.id).filter((session) => {
      if (session.status !== 'ACTIVE' && session.status !== 'STARTING') return false
      if (now - Date.parse(session.updatedAt) > this.options.staleMinutes * 60_000) return false
      const agent = this.store.getAgent(session.agentId)
      return agent?.role.startsWith('JUDGE_') ?? false
    })
    for (const run of this.store.listJuryRuns(project.id)) {
      if (run.status !== 'RUNNING') continue
      findings.push({
        code: 'JURY_RUN_INTERRUPTED',
        entityType: 'jury_run',
        entityId: run.id,
        severity: activeJudgeSessions.length > 0 ? 'INFO' : 'WARNING',
        message:
          activeJudgeSessions.length > 0
            ? `Jury run ${run.id} has active judge sessions`
            : `Jury run ${run.id} was interrupted`,
        requiresHuman: activeJudgeSessions.length > 0,
        detail: {
          moduleVersionId: run.moduleVersionId,
          activeJudgeSessions: activeJudgeSessions.length,
        },
        ...(activeJudgeSessions.length === 0
          ? { apply: () => this.store.updateJuryRunStatus(run.id, 'FAILED') }
          : {}),
      })
    }
    for (const module of this.store.listModules(project.id)) {
      if (module.status !== 'IN_REVIEW' || !module.currentVersionId) continue
      const reviews = this.store.listReviewsForVersion(module.currentVersionId)
      if (reviews.length < 4) {
        findings.push({
          code: 'REVIEW_INCOMPLETE',
          entityType: 'module_version',
          entityId: module.currentVersionId,
          severity: 'INFO',
          message: `Module ${module.name} has ${reviews.length}/4 judge reviews`,
          requiresHuman: true,
          detail: { moduleId: module.id, reviews: reviews.length },
        })
      }
    }
  }

  private collectIntegrations(project: Project, findings: FindingWithApply[]): void {
    for (const run of this.store.listIntegrationRuns(project.id)) {
      if (run.status !== 'RUNNING') continue
      findings.push({
        code: 'INTEGRATION_RUN_INTERRUPTED',
        entityType: 'integration_run',
        entityId: run.id,
        severity: 'WARNING',
        message: `Integration run ${run.id} was interrupted`,
        requiresHuman: false,
        detail: { attempt: run.attempt, inputHash: run.inputHash },
        apply: () => {
          this.store.updateIntegrationRun(run.id, {
            status: 'FAILED',
            error: 'Interrupted integration recovered at startup',
          })
          const current = this.store.getProject(project.id)
          if (
            current?.status === 'INTEGRATING' &&
            canTransitionProject(current.status, 'RUNNING')
          ) {
            this.store.updateProjectStatus(current.id, 'RUNNING', current.version)
          }
        },
      })
    }
  }

  private collectFeedback(project: Project, findings: FindingWithApply[]): void {
    for (const feedback of this.store.listFeedbackRuns(project.id)) {
      if (feedback.status !== 'RUNNING') continue
      findings.push({
        code: 'FEEDBACK_RUN_INTERRUPTED',
        entityType: 'feedback_run',
        entityId: feedback.id,
        severity: 'WARNING',
        message: `Feedback run ${feedback.id} was interrupted`,
        requiresHuman: false,
        detail: { manifestId: feedback.manifestId },
        apply: () => {
          this.store.updateFeedbackRun(feedback.id, {
            status: 'FAILED',
            verdict: 'FAIL',
            report: {
              ...feedback.report,
              recoveryError: 'Interrupted feedback recovered at startup',
            },
            hash: sha256({ previous: feedback.hash, recovery: 'interrupted' }),
          })
          const current = this.store.getProject(project.id)
          if (current?.status === 'FEEDBACK' && canTransitionProject(current.status, 'RUNNING')) {
            this.store.updateProjectStatus(current.id, 'RUNNING', current.version)
          }
        },
      })
    }
  }

  private collectMessagesAndOutbox(project: Project, findings: FindingWithApply[]): void {
    const queued = this.store.listProjectMessages(project.id, 'QUEUED')
    if (queued.length > 0) {
      findings.push({
        code: 'MESSAGES_PENDING',
        entityType: 'message',
        severity: 'WARNING',
        message: `${queued.length} queued messages remain pending`,
        requiresHuman: false,
        detail: { count: queued.length, ids: queued.slice(0, 20).map((message) => message.id) },
      })
    }
    const outbox = this.store.listOutboxForProject(project.id, 'PENDING')
    if (outbox.length > 0) {
      findings.push({
        code: 'OUTBOX_PENDING',
        entityType: 'event_outbox',
        severity: 'INFO',
        message: `${outbox.length} outbox events remain pending`,
        requiresHuman: false,
        detail: { count: outbox.length },
      })
    }
  }

  private collectOperations(project: Project, findings: FindingWithApply[]): void {
    for (const operation of this.store.listOperations(project.id)) {
      if (operation.status !== 'RUNNING' || operation.leaseExpiresAt > new Date().toISOString()) {
        continue
      }
      findings.push({
        code: 'OPERATION_LEASE_EXPIRED',
        entityType: 'operation',
        entityId: operation.id,
        severity: 'WARNING',
        message: `Operation ${operation.kind}/${operation.idempotencyKey} has an expired lease`,
        requiresHuman: false,
        detail: {
          kind: operation.kind,
          attempts: operation.attempts,
          leaseExpiresAt: operation.leaseExpiresAt,
        },
        apply: () => this.store.failOperation(operation.id, 'Recovered expired operation lease'),
      })
    }
  }

  private collectApprovals(project: Project, findings: FindingWithApply[]): void {
    for (const approved of this.store.listApprovedModules(project.id)) {
      const version = this.store.getModuleVersion(approved.moduleVersionId)
      if (
        !version ||
        version.commitSha !== approved.commitSha ||
        version.artifactHash !== approved.artifactHash
      ) {
        findings.push({
          code: 'APPROVAL_INTEGRITY_MISMATCH',
          entityType: 'approved_module',
          entityId: approved.id,
          severity: 'CRITICAL',
          message: `Approved module ${approved.moduleId} no longer matches its version`,
          requiresHuman: true,
          detail: {
            moduleVersionId: approved.moduleVersionId,
            approvedCommit: approved.commitSha,
            currentCommit: version?.commitSha ?? null,
          },
        })
      }
    }
  }

  private collectResources(project: Project, findings: FindingWithApply[]): void {
    if (!this.resources) return
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(project.status)) return
    if (!this.store.getProjectResource(project.id)) return
    const snapshot = this.resources.snapshot(project.id)
    if (snapshot.exceeded.length > 0) {
      findings.push({
        code: 'RESOURCE_LIMIT_EXCEEDED',
        entityType: 'project',
        entityId: project.id,
        severity: 'CRITICAL',
        message: `Project resource limits exceeded: ${snapshot.exceeded.join(', ')}`,
        requiresHuman: true,
        detail: { ...snapshot },
      })
    }
  }

  private collectProjectStage(project: Project, findings: FindingWithApply[]): void {
    if (project.status === 'INTEGRATING') {
      const running = this.store
        .listIntegrationRuns(project.id)
        .some((run) => run.status === 'RUNNING')
      if (!running) {
        findings.push({
          code: 'PROJECT_STALE_INTEGRATING',
          entityType: 'project',
          entityId: project.id,
          severity: 'WARNING',
          message: 'Project is INTEGRATING without a running integration',
          requiresHuman: false,
          detail: { status: project.status },
          apply: () => this.store.updateProjectStatus(project.id, 'RUNNING', project.version),
        })
      }
    }
    if (project.status === 'RUNNING') {
      const plans = this.store.listPlans(project.id)
      if (!plans.some((plan) => plan.status === 'APPROVED')) {
        findings.push({
          code: 'PROJECT_WITHOUT_APPROVED_PLAN',
          entityType: 'project',
          entityId: project.id,
          severity: 'CRITICAL',
          message: 'Project is RUNNING without an approved plan',
          requiresHuman: true,
          detail: { plans: plans.map((plan) => ({ id: plan.id, status: plan.status })) },
        })
      }
    }
    if (project.status === 'COMPLETED') {
      const pending = this.store
        .listTasks(project.id)
        .filter((task) => task.state === 'PENDING' || task.state === 'READY')
      if (pending.length > 0) {
        findings.push({
          code: 'TASK_PENDING_AFTER_COMPLETION',
          entityType: 'project',
          entityId: project.id,
          severity: 'WARNING',
          message: `${pending.length} tasks remain pending after project completion`,
          requiresHuman: true,
          detail: { taskIds: pending.map((task) => task.id) },
        })
      }
    }
  }

  private stateHash(projectId: ProjectId): string {
    const project = this.store.getProject(projectId)
    const tasks = this.store.listTasks(projectId)
    const sessions = this.store.listSessions(projectId)
    const worktrees = this.store.listWorktrees(projectId)
    return sha256({
      project: project
        ? { status: project.status, version: project.version, updatedAt: project.updatedAt }
        : null,
      tasks: tasks.map((task) => ({
        id: task.id,
        state: task.state,
        version: task.version,
        updatedAt: task.updatedAt,
      })),
      modules: this.store.listModules(projectId).map((module) => ({
        id: module.id,
        status: module.status,
        currentVersionId: module.currentVersionId ?? null,
        updatedAt: module.updatedAt,
      })),
      approvals: this.store.listApprovedModules(projectId).map((approved) => ({
        id: approved.id,
        moduleVersionId: approved.moduleVersionId,
        commitSha: approved.commitSha,
        artifactHash: approved.artifactHash,
      })),
      sessions: sessions.map((session) => ({
        id: session.id,
        status: session.status,
        updatedAt: session.updatedAt,
      })),
      leases: this.store
        .listActiveLeases()
        .filter((lease) => tasks.some((task) => task.id === lease.taskId)),
      worktrees: worktrees.map((worktree) => ({
        id: worktree.id,
        status: worktree.status,
        updatedAt: worktree.updatedAt,
      })),
      jury: this.store.listJuryRuns(projectId).map((run) => ({
        id: run.id,
        status: run.status,
      })),
      integrations: this.store.listIntegrationRuns(projectId).map((run) => ({
        id: run.id,
        status: run.status,
      })),
      feedback: this.store.listFeedbackRuns(projectId).map((run) => ({
        id: run.id,
        status: run.status,
        verdict: run.verdict ?? null,
      })),
    })
  }

  private notifyParent(
    project: Project,
    run: RecoveryRunRecord,
    findings: readonly RecoveryFinding[],
  ): void {
    const parent = this.store.getAgentByOpenCodeId(project.id, 'padre')
    const coordinator = this.store.getAgentByOpenCodeId(project.id, 'coordinador')
    if (!parent || !coordinator) return
    this.store.createMessage({
      projectId: project.id,
      fromAgentId: coordinator.id,
      toAgentId: parent.id,
      correlationId: `recovery:${run.id}`,
      kind: 'INFO',
      priority: 80,
      payload: {
        kind: 'RecoveryReport',
        recoveryId: run.id,
        mode: run.mode,
        findings: findings.length,
        applied: run.appliedCount,
        requiresHuman: findings.filter((finding) => finding.requiresHuman).length,
        codes: [...new Set(findings.map((finding) => finding.code))],
        summary: run.summary,
      },
      requiresApproval: false,
      idempotencyKey: `recovery-report:${run.id}`,
    })
  }

  private emit(
    projectId: ProjectId | undefined,
    type: string,
    aggregateType: string,
    aggregateId: string,
    actorId: string,
    payload: Record<string, unknown>,
  ): void {
    if (!projectId) return
    const event = this.store.appendEvent({
      projectId,
      type,
      aggregateType,
      aggregateId,
      actorId,
      payload,
    })
    this.store.appendOutbox(event.id, 'orchestrator.recovery', {
      eventId: event.id,
      type: event.type,
      aggregateId: event.aggregateId,
    })
  }
}

export function summarizeRecovery(actions: readonly RecoveryActionRecord[]): string {
  if (actions.length === 0) return 'Sin hallazgos.'
  return actions
    .map(
      (action) => `${action.status} ${action.code} ${action.entityType}:${action.entityId ?? ''}`,
    )
    .join('\n')
}

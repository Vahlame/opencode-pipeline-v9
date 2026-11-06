import type { AppConfig } from '../config/env.js'
import { parseModelRef } from '../config/env.js'
import type { Agent, Contract } from '../domain/index.js'
import type { ProjectId } from '../domain/ids.js'
import { addSecondsIso, nowIso } from '../domain/id-factory.js'
import type { OrchestratorService } from './service.js'
import type { SqliteStore } from '../persistence/store.js'
import type { SessionManager } from '../sessions/manager.js'
import type { WorktreeManager } from '../worktrees/manager.js'
import type { TaskClaim, TaskExecutionResult } from './execution-types.js'
import type { ResourceGovernor } from '../resources/governor.js'

class TestFailureError extends Error {
  readonly code = 'TEST_FAILURE'
  constructor(message: string) {
    super(message)
    this.name = 'TestFailureError'
  }
}

export class TaskExecutor {
  constructor(
    private readonly store: SqliteStore,
    private readonly service: OrchestratorService,
    private readonly worktrees: WorktreeManager,
    private readonly sessions: SessionManager,
    private readonly config: AppConfig,
    private readonly resources?: ResourceGovernor,
  ) {}

  async execute(claim: TaskClaim): Promise<TaskExecutionResult> {
    const startedAt = nowIso()
    const { task, contract, agent } = claim
    let sessionRecordId: string | undefined
    let opencodeSessionId: string | undefined
    let timer: NodeJS.Timeout | undefined
    try {
      this.resources?.assertAvailable(task.projectId)
      const worktree = this.getOrCreateWorktree(task)
      const session = await this.sessions.createForTaskAsync({
        task,
        agent,
        contract,
        worktree,
        ...(this.model() ? { model: this.model() } : {}),
      })
      sessionRecordId = session.record.id
      opencodeSessionId = session.view.id
      this.store.updateTaskAttempt(claim.attempt.id, 'RUNNING', { sessionId: session.record.id })

      timer = setInterval(() => {
        try {
          this.store.renewLease(task.id, addSecondsIso(this.config.ORCH_LEASE_SECONDS))
          this.store.setTaskLease(task.id, addSecondsIso(this.config.ORCH_LEASE_SECONDS))
        } catch {
          // El lease puede haber sido liberado por un watchdog.
        }
      }, this.config.ORCH_HEARTBEAT_SECONDS * 1000)
      timer.unref?.()

      await this.sessions.prompt(session.record, this.contractPrompt(task, contract, worktree.path))
      await this.sessions.wait(session.record, this.config.ORCH_SESSION_TIMEOUT_MS)

      this.worktrees.validateChangedPaths(worktree.path, contract.allowedPaths)
      const testResults = this.worktrees.runTests(
        worktree.path,
        contract.acceptanceTests,
        this.config.ORCH_SESSION_TIMEOUT_MS,
      )
      const failedTest = testResults.find((result) => !result.passed)
      if (failedTest) {
        throw new TestFailureError(
          `Contract test failed (${failedTest.command}, exit ${failedTest.exitCode}): ${failedTest.stderr || failedTest.stdout}`,
        )
      }

      const commit = this.worktrees.commit(
        worktree.path,
        contract.allowedPaths,
        `task(${task.id}): ${contract.objective}`,
      )
      const principal = this.agentPrincipal(agent, task.projectId)
      this.service.createModuleVersion(principal, {
        moduleId: contract.moduleId,
        commitSha: commit.commitSha,
        treeHash: commit.treeHash,
        artifactHash: commit.artifactHash,
      })

      this.store.transaction(() => {
        this.store.updateWorktreeStatus(worktree.id, 'COMMITTED')
        this.store.updateTaskState(task.id, 'IN_REVIEW')
        this.store.updateTaskAttempt(claim.attempt.id, 'SUCCEEDED', {
          sessionId: session.record.id,
        })
        this.store.setTaskLease(task.id, null)
        this.store.deleteLease(task.id)
        this.store.setAgentCurrentTask(agent.id, null)
        this.store.updateSessionStatus(session.record.id, 'IDLE')
        this.emit(task.projectId, 'task.delivery', 'task', task.id, agent.id, {
          taskId: task.id,
          commitSha: commit.commitSha,
          filesChanged: commit.filesChanged,
          tests: testResults.length,
        })
        this.emit(task.projectId, 'task.in_review', 'task', task.id, agent.id, {
          taskId: task.id,
          commitSha: commit.commitSha,
        })
      })

      return {
        taskId: task.id,
        status: 'SUCCEEDED',
        sessionId: session.record.id,
        commitSha: commit.commitSha,
        startedAt,
        endedAt: nowIso(),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.stopSession(opencodeSessionId)
      this.failTask(task, claim, message, error instanceof TestFailureError)
      return {
        taskId: task.id,
        status: error instanceof TestFailureError ? 'BLOCKED' : 'FAILED',
        ...(sessionRecordId ? { sessionId: sessionRecordId } : {}),
        error: message,
        startedAt,
        endedAt: nowIso(),
      }
    } finally {
      if (timer) clearInterval(timer)
    }
  }

  private getOrCreateWorktree(task: TaskClaim['task']) {
    const existing = this.store.getWorktreeByTask(task.id)
    if (existing) {
      if (existing.status === 'REMOVED') throw new Error(`Worktree for ${task.id} was removed`)
      return existing
    }
    const created = this.worktrees.create(task.id, this.config.ORCH_GIT_BASE_REF)
    return this.store.createWorktree({
      taskId: task.id,
      ...(task.moduleId ? { moduleId: task.moduleId } : {}),
      path: created.path,
      branch: created.branch,
      baseCommit: created.baseCommit,
      status: 'ACTIVE',
    })
  }

  private failTask(
    task: TaskClaim['task'],
    claim: TaskClaim,
    message: string,
    blocked: boolean,
  ): void {
    const canRetry =
      !blocked && task.attemptCount < Math.min(task.maxAttempts, this.config.ORCH_TASK_MAX_ATTEMPTS)
    this.store.transaction(() => {
      const worktree = this.store.getWorktreeByTask(task.id)
      if (worktree) this.store.updateWorktreeStatus(worktree.id, 'FAILED')
      this.store.updateTaskAttempt(claim.attempt.id, 'FAILED', {
        error: message,
      })
      this.store.deleteLease(task.id)
      this.store.setTaskLease(task.id, null)
      this.store.setAgentCurrentTask(claim.agent.id, null)
      if (canRetry) {
        this.store.updateTaskState(task.id, 'REWORK_REQUIRED')
        this.store.updateTaskState(task.id, 'READY')
      } else {
        this.store.updateTaskState(task.id, blocked ? 'BLOCKED' : 'FAILED')
      }
      this.emit(task.projectId, 'task.execution_failed', 'task', task.id, claim.agent.id, {
        taskId: task.id,
        error: message,
        retry: canRetry,
      })
    })
  }

  private async stopSession(sessionID: string | undefined): Promise<void> {
    if (!sessionID) return
    try {
      await this.sessions.interruptByOpenCodeId(sessionID)
    } catch {
      // La sesión pudo haber terminado ya.
    }
  }

  private model() {
    return parseModelRef(this.config.ORCH_AGENT_MODEL ?? this.config.OPENCODE_MODEL)
  }

  private agentPrincipal(agent: Agent, projectId: ProjectId) {
    return {
      subjectId: agent.id,
      kind: 'AGENT' as const,
      role: agent.role,
      projectId,
      agentId: agent.id,
    }
  }

  private contractPrompt(
    task: TaskClaim['task'],
    contract: Contract,
    worktreePath: string,
  ): string {
    const tasks = this.store.listTasks(task.projectId)
    const modules = this.store.listModules(task.projectId)
    const dependencies = this.store.listDependenciesForProject(task.projectId)
    const sharedState = {
      projectId: task.projectId,
      planId: task.planId,
      tasks: tasks.map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        state: candidate.state,
        moduleId: candidate.moduleId ?? null,
        dependencies: dependencies
          .filter((dependency) => dependency.taskId === candidate.id)
          .map((dependency) => dependency.dependsOnTaskId),
      })),
      modules: modules.map((module) => ({
        id: module.id,
        name: module.name,
        status: module.status,
        currentVersionId: module.currentVersionId ?? null,
      })),
    }
    return [
      'Eres un especialista trabajando en un worktree Git aislado.',
      `Worktree: ${worktreePath}`,
      `Tarea: ${task.title}`,
      task.description,
      '',
      'Contrato JSON:',
      JSON.stringify(
        {
          objective: contract.objective,
          allowedPaths: contract.allowedPaths,
          inputInterfaces: contract.inputInterfaces,
          outputInterfaces: contract.outputInterfaces,
          acceptanceTests: contract.acceptanceTests,
          deliveryFormat: contract.deliveryFormat,
        },
        null,
        2,
      ),
      '',
      'Estado compartido de solo lectura (no incluye mensajes privados):',
      JSON.stringify(sharedState, null, 2),
      '',
      'Reglas:',
      '- Edita únicamente las rutas permitidas.',
      '- No uses shell, git, red ni subagentes.',
      '- Usa las herramientas de escritura/edición para crear el código y los tests.',
      '- Los tests serán ejecutados por el orquestador después de tu respuesta.',
      '- No inventes commits; el orquestador crea el commit y la versión inmutable.',
      '- Cuando termines, responde con un resumen breve y hechos verificables.',
    ].join('\n')
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
    this.store.appendOutbox(event.id, 'orchestrator.execution', {
      eventId: event.id,
      type: event.type,
      aggregateId: event.aggregateId,
    })
  }
}

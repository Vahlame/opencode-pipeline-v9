import type { Contract, Module, Task } from '../domain/index.js'
import type { ModuleVersionId, ProjectId, TaskId } from '../domain/ids.js'
import { sha256 } from '../security/hash.js'
import type { SqliteStore } from '../persistence/store.js'
import type { JuryConsolidation } from './verdict.js'

export interface JuryDecisionResult {
  readonly verdict: JuryConsolidation['verdict']
  readonly reworkTaskId?: string
  readonly approvedModuleId?: string
  readonly blocked: boolean
}

/**
 * Aplica el veredicto consolidado. No ejecuta modelos: solo transiciones,
 * versiones, mensajes y eventos deterministas.
 */
export class JuryDecisionService {
  constructor(
    private readonly store: SqliteStore,
    private readonly options: { maxReworkCycles: number },
  ) {}

  apply(input: {
    projectId: ProjectId
    taskId: TaskId
    moduleVersionId: ModuleVersionId
    juryRunId: string
    consolidation: JuryConsolidation
  }): JuryDecisionResult {
    const task = this.store.getTask(input.taskId)
    if (!task) throw new Error(`Task ${input.taskId} not found`)
    const version = this.store.getModuleVersion(input.moduleVersionId)
    if (!version) throw new Error(`Module version ${input.moduleVersionId} not found`)
    const module = this.store.getModule(version.moduleId)
    if (!module) throw new Error(`Module ${version.moduleId} not found`)

    if (input.consolidation.verdict === 'APPROVED') {
      return this.store.transaction(() => {
        this.store.updateTaskState(task.id, 'APPROVED')
        this.store.updateModuleStatus(module.id, 'APPROVED')
        this.store.updateModuleVersionStatus(version.id, 'APPROVED')
        const approved = this.store.createApprovedModule({
          projectId: input.projectId,
          moduleId: module.id,
          moduleVersionId: version.id,
          commitSha: version.commitSha,
          artifactHash: version.artifactHash,
          juryRunId: input.juryRunId,
        })
        this.emit(input.projectId, 'jury.approved', 'module_version', version.id, 'jury', {
          moduleId: module.id,
          moduleVersionId: version.id,
          commitSha: version.commitSha,
          approvedModuleId: approved.id,
        })
        return { verdict: 'APPROVED', approvedModuleId: approved.id, blocked: false }
      })
    }

    if (input.consolidation.verdict === 'INCOMPLETE') {
      return this.store.transaction(() => {
        this.store.updateTaskState(task.id, 'BLOCKED')
        this.emit(input.projectId, 'jury.incomplete', 'module_version', version.id, 'jury', {
          missingRoles: input.consolidation.missingRoles,
        })
        return { verdict: 'INCOMPLETE', blocked: true }
      })
    }

    return this.store.transaction(() => {
      this.store.updateTaskState(task.id, 'REWORK_REQUIRED')
      this.store.updateModuleStatus(module.id, 'REWORK_REQUIRED')
      this.store.updateModuleVersionStatus(version.id, 'REWORK_REQUIRED')
      const nextCycle = task.reviewCycle + 1
      if (nextCycle > this.options.maxReworkCycles) {
        this.store.updateTaskState(task.id, 'BLOCKED')
        this.emit(input.projectId, 'jury.max_cycles', 'module_version', version.id, 'jury', {
          cycle: task.reviewCycle,
          maxReworkCycles: this.options.maxReworkCycles,
        })
        return { verdict: 'REWORK_REQUIRED', blocked: true }
      }

      const contract = this.resolveContract(task, module)
      const reworkTask = this.store.createTask({
        projectId: input.projectId,
        planId: task.planId,
        moduleId: module.id,
        title: `Rework ${module.name} cycle ${nextCycle}`,
        description: this.reworkDescription(input.consolidation),
        state: 'PENDING',
        priority: task.priority,
        ...(task.ownerAgentId ? { ownerAgentId: task.ownerAgentId } : {}),
        maxAttempts: task.maxAttempts,
        reviewCycle: nextCycle,
      })
      if (contract) {
        const clone = this.store.createContract({
          taskId: reworkTask.id,
          moduleId: module.id,
          version: 1,
          objective: contract.objective,
          allowedPaths: contract.allowedPaths,
          inputInterfaces: contract.inputInterfaces,
          outputInterfaces: contract.outputInterfaces,
          acceptanceTests: contract.acceptanceTests,
          limits: contract.limits,
          deliveryFormat: contract.deliveryFormat,
          hash: sha256({
            sourceContract: contract.hash,
            taskId: reworkTask.id,
            cycle: nextCycle,
          }),
          status: 'ACTIVE',
        })
        this.store.setTaskContract(reworkTask.id, clone.id)
      }

      const owner = task.ownerAgentId ? this.store.getAgent(task.ownerAgentId) : undefined
      const coordinator = this.store.getAgentByOpenCodeId(input.projectId, 'coordinador')
      if (owner && coordinator) {
        this.store.createMessage({
          projectId: input.projectId,
          fromAgentId: coordinator.id,
          toAgentId: owner.id,
          correlationId: `rework:${version.id}`,
          kind: 'ORDER',
          priority: 80,
          payload: {
            reworkTaskId: reworkTask.id,
            moduleVersionId: version.id,
            findings: input.consolidation.blocking,
            recommendations: input.consolidation.recommendations,
          },
          requiresApproval: true,
          approvedBy: coordinator.id,
          idempotencyKey: `jury-rework:${version.id}`,
        })
      }

      this.emit(input.projectId, 'jury.rework_required', 'module_version', version.id, 'jury', {
        moduleId: module.id,
        moduleVersionId: version.id,
        reworkTaskId: reworkTask.id,
        cycle: nextCycle,
        blocking: input.consolidation.blocking,
        recommendations: input.consolidation.recommendations,
      })
      return { verdict: 'REWORK_REQUIRED', reworkTaskId: reworkTask.id, blocked: false }
    })
  }

  private resolveContract(task: Task, module: Module): Contract | undefined {
    if (task.contractId) {
      const contract = this.store.getContract(task.contractId)
      if (contract) return contract
    }
    return this.store
      .listContracts(module.projectId)
      .find((contract) => contract.taskId === task.id && contract.status === 'ACTIVE')
  }

  private reworkDescription(consolidation: JuryConsolidation): string {
    const blocking = consolidation.blocking
      .map((item) => `- [${item.judgeRole}] ${item.finding.message}`)
      .join('\n')
    const recommendations = consolidation.recommendations
      .map((item) => `- [${item.judgeRole}] ${item.finding.message}`)
      .join('\n')
    return [
      'Corrige el módulo rechazado. El jurado determinó estos bloqueos:',
      blocking || '- sin detalle',
      recommendations ? `Recomendaciones no bloqueantes:\n${recommendations}` : '',
      'No modifiques otros módulos. Entrega código y tests; el orquestador creará la nueva versión.',
    ].join('\n\n')
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
    this.store.appendOutbox(event.id, 'orchestrator.jury', {
      eventId: event.id,
      type: event.type,
      aggregateId: event.aggregateId,
    })
  }
}

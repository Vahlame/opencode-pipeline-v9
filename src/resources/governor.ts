import type { AppConfig } from '../config/env.js'
import type { ProjectId } from '../domain/ids.js'
import { nowIso } from '../domain/id-factory.js'
import type { ProjectResourceRecord, SqliteStore } from '../persistence/store.js'

export interface ResourceLimits {
  readonly maxProjectTokens: number
  readonly maxProjectCostUsd: number
  readonly maxProjectMinutes: number
  readonly inputCostPerMillion: number
  readonly outputCostPerMillion: number
}

export interface ResourceSnapshot {
  readonly projectId: ProjectId
  readonly startedAt: string
  readonly elapsedMinutes: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly estimatedCostUsd: number
  readonly limits: ResourceLimits
  readonly exceeded: readonly string[]
  readonly lastLimitCode?: string
  readonly lastLimitAt?: string
}

export class ResourceLimitError extends Error {
  readonly code = 'RESOURCE_LIMIT'
  readonly projectId: ProjectId
  readonly limit: string

  constructor(projectId: ProjectId, limit: string) {
    super(`Resource limit reached for ${projectId}: ${limit}`)
    this.name = 'ResourceLimitError'
    this.projectId = projectId
    this.limit = limit
  }
}

export class ResourceGovernor {
  readonly limits: ResourceLimits

  constructor(
    private readonly store: SqliteStore,
    options: ResourceLimits,
  ) {
    this.limits = options
  }

  static fromConfig(store: SqliteStore, config: AppConfig): ResourceGovernor {
    return new ResourceGovernor(store, {
      maxProjectTokens: config.ORCH_MAX_PROJECT_TOKENS,
      maxProjectCostUsd: config.ORCH_MAX_PROJECT_COST_USD,
      maxProjectMinutes: config.ORCH_PROJECT_MAX_MINUTES,
      inputCostPerMillion: config.ORCH_INPUT_COST_PER_MILLION,
      outputCostPerMillion: config.ORCH_OUTPUT_COST_PER_MILLION,
    })
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  recordUsage(
    projectId: ProjectId,
    inputTokens: number,
    outputTokens: number,
  ): ProjectResourceRecord {
    const project = this.store.getProject(projectId)
    this.store.ensureProjectResource(projectId, project?.createdAt)
    const cost =
      (inputTokens / 1_000_000) * this.limits.inputCostPerMillion +
      (outputTokens / 1_000_000) * this.limits.outputCostPerMillion
    return this.store.recordProjectUsage(projectId, inputTokens, outputTokens, cost)
  }

  recordTextUsage(projectId: ProjectId, input: string, output: string): ProjectResourceRecord {
    return this.recordUsage(projectId, this.estimateTokens(input), this.estimateTokens(output))
  }

  assertAvailable(projectId: ProjectId): ResourceSnapshot {
    const project = this.store.getProject(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)
    this.store.ensureProjectResource(projectId, project.createdAt)
    const snapshot = this.snapshot(projectId)
    if (project.status !== 'RUNNING') return snapshot
    if (snapshot.exceeded.length === 0) return snapshot
    const limit = snapshot.exceeded[0]!
    this.store.recordProjectLimit(projectId, limit)
    this.pauseProject(projectId, limit)
    throw new ResourceLimitError(projectId, limit)
  }

  snapshot(projectId: ProjectId): ResourceSnapshot {
    const project = this.store.getProject(projectId)
    const resource = this.store.getProjectResource(projectId)
    const startedAt = resource?.startedAt ?? project?.createdAt ?? nowIso()
    const elapsedMinutes = Math.max(0, (Date.now() - Date.parse(startedAt)) / 60_000)
    const totalTokens = (resource?.inputTokens ?? 0) + (resource?.outputTokens ?? 0)
    const estimatedCostUsd = resource?.estimatedCostUsd ?? 0
    const exceeded: string[] = []
    if (totalTokens >= this.limits.maxProjectTokens) exceeded.push('max_project_tokens')
    if (estimatedCostUsd >= this.limits.maxProjectCostUsd) {
      exceeded.push('max_project_cost_usd')
    }
    if (elapsedMinutes >= this.limits.maxProjectMinutes) exceeded.push('max_project_minutes')
    return {
      projectId,
      startedAt,
      elapsedMinutes: Math.round(elapsedMinutes * 100) / 100,
      inputTokens: resource?.inputTokens ?? 0,
      outputTokens: resource?.outputTokens ?? 0,
      totalTokens,
      estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
      limits: this.limits,
      exceeded,
      ...(resource?.lastLimitCode ? { lastLimitCode: resource.lastLimitCode } : {}),
      ...(resource?.lastLimitAt ? { lastLimitAt: resource.lastLimitAt } : {}),
    }
  }

  pauseForLimit(projectId: ProjectId, code: string): void {
    this.store.recordProjectLimit(projectId, code)
    this.pauseProject(projectId, code)
  }

  private pauseProject(projectId: ProjectId, code: string): void {
    const project = this.store.getProject(projectId)
    if (!project || project.status !== 'RUNNING') return
    this.store.transaction(() => {
      this.store.updateProjectStatus(project.id, 'PAUSED', project.version)
      const event = this.store.appendEvent({
        projectId,
        type: 'resource.limit_reached',
        aggregateType: 'project',
        aggregateId: project.id,
        actorId: 'resource-governor',
        payload: {
          code,
          status: 'PAUSED',
          ...this.snapshot(projectId),
        },
      })
      this.store.appendOutbox(event.id, 'orchestrator.resources', {
        eventId: event.id,
        type: event.type,
        aggregateId: event.aggregateId,
      })
    })
  }
}

export function emptyResourceSnapshot(
  projectId: ProjectId,
  limits: ResourceLimits,
): ResourceSnapshot {
  const timestamp = nowIso()
  return {
    projectId,
    startedAt: timestamp,
    elapsedMinutes: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    limits,
    exceeded: [],
  }
}

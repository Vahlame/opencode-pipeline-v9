import { join } from 'node:path'
import type { Contract, Module, ModuleVersion, Plan, Project } from '../domain/index.js'
import type { AgentId, ModuleId, ModuleVersionId, PlanId, ProjectId } from '../domain/ids.js'
import { canTransitionProject } from '../domain/transitions.js'
import type { AuthorizationService } from '../auth/authorization.js'
import type { Principal } from '../auth/types.js'
import type {
  IntegrationAdapterRecord,
  IntegrationConflictRecord,
  IntegrationManifestRecord,
  IntegrationModuleRecord,
  IntegrationRunRecord,
  SqliteStore,
} from '../persistence/store.js'
import { sha256 } from '../security/hash.js'
import { redactText } from '../security/redaction.js'
import { WorktreeError, matchesAllowedPath } from '../worktrees/manager.js'
import type { TestCommandResult } from '../worktrees/manager.js'
import { ConflictError, NotFoundError, ValidationError } from '../orchestrator/errors.js'
import {
  IntegrationAdapterSpecSchema,
  IntegrationRequestSchema,
  type IntegrationAdapterSpec,
  type IntegrationCriterion,
  type IntegrationManifestAdapter,
  type IntegrationManifestConflict,
  type IntegrationManifestModule,
  type IntegrationRequest,
} from './contracts.js'
import {
  buildAdapterSpecHash,
  buildInputHash,
  buildManifest,
  buildManifestHash,
  deterministicCommitEpoch,
  type ResolvedIntegrationInput,
  type ResolvedModuleSnapshot,
} from './manifest.js'
import { moduleRootFromScope, type IntegrationWorkspace } from './workspace.js'
import type { AdapterAuthor } from './adapter-author.js'

export interface IntegrationManagerOptions {
  readonly baseRef: string
  readonly testsTimeoutMs: number
  readonly worktreeRoot: string
}

export interface IntegrationResult {
  readonly status: 'SUCCEEDED' | 'STRUCTURAL_FAILED' | 'FAILED'
  readonly run: IntegrationRunRecord
  readonly modules: readonly IntegrationModuleRecord[]
  readonly adapters: readonly IntegrationAdapterRecord[]
  readonly conflicts: readonly IntegrationConflictRecord[]
  readonly manifest?: IntegrationManifestRecord
  readonly reused: boolean
}

interface ResolvedModule {
  readonly module: Module
  readonly version: ModuleVersion
  readonly approvedModuleId: string
  readonly approvedAt: string
  readonly contract: Contract
  readonly roots: readonly string[]
  readonly snapshot: ResolvedModuleSnapshot
}

type IssueType = 'MINOR' | 'STRUCTURAL'

interface IntegrationIssue {
  readonly type: IssueType
  readonly code: string
  readonly message: string
  readonly modules: readonly string[]
  readonly evidence: readonly string[]
  readonly resolution?: string
}

interface PreparedIntegration {
  readonly resolved: ResolvedModule[]
  readonly issues: IntegrationIssue[]
  readonly interfaceResolutions: ReadonlyMap<string, IntegrationAdapterSpec>
}

const RESERVED_MODULE_PREFIXES = [
  '.git',
  '.opencode',
  '.runtime',
  '.worktrees',
  'integration',
  'migrations',
  'node_modules',
  'scripts',
  'src',
  'tests',
] as const

export class IntegrationManager {
  constructor(
    private readonly store: SqliteStore,
    private readonly authz: AuthorizationService,
    private readonly workspace: IntegrationWorkspace,
    private readonly options: IntegrationManagerOptions,
    private readonly adapterAuthor?: AdapterAuthor,
  ) {}

  async run(principal: Principal, rawRequest: IntegrationRequest): Promise<IntegrationResult> {
    let request = IntegrationRequestSchema.parse(rawRequest)
    const projectId = request.projectId as ProjectId
    const planId = request.planId as PlanId
    this.authz.require(principal, 'integration.run', { type: 'project', id: projectId })

    const project = this.store.getProject(projectId)
    if (!project) throw new NotFoundError(`Project ${projectId} not found`)
    const plan = this.store.getPlan(planId)
    if (!plan || plan.projectId !== projectId) throw new NotFoundError('Approved plan not found')
    if (plan.status !== 'APPROVED') throw new ConflictError(`Plan ${planId} is ${plan.status}`)

    const baseRef = request.baseRef ?? this.options.baseRef
    const baseCommit = this.resolveBaseCommit(baseRef)
    const criteria = this.resolveCriteria(plan, request)
    let prepared = this.prepareModules(request, project, plan, baseCommit, criteria)
    if (this.adapterAuthor) {
      const proposed: IntegrationAdapterSpec[] = []
      for (const issue of prepared.issues.filter((item) => item.code === 'ADAPTER_REQUIRED')) {
        const module = prepared.resolved.find(
          (candidate) => candidate.module.id === issue.modules[0],
        )
        const mapping = request.interfaceMappings.find(
          (candidate) => candidate.moduleId === issue.modules[0],
        )
        if (!module || !mapping) continue
        if (request.adapters.some((adapter) => adapter.moduleId === module.module.id)) continue
        try {
          const adapter = await this.adapterAuthor.propose({
            projectId,
            module: module.module,
            contract: module.contract,
            commitSha: module.version.commitSha,
            mapping,
          })
          proposed.push(adapter)
        } catch (error) {
          prepared.issues.push({
            type: 'MINOR',
            code: 'ADAPTER_AUTHOR_FAILED',
            message: `Adapter author could not propose an adapter for ${module.module.name}`,
            modules: [module.module.id],
            evidence: [
              redactText(error instanceof Error ? (error.stack ?? error.message) : String(error)),
            ],
          })
        }
      }
      if (proposed.length > 0) {
        request = { ...request, adapters: [...request.adapters, ...proposed] }
        prepared = this.prepareModules(request, project, plan, baseCommit, criteria)
      }
    }

    const resolvedInput = this.toResolvedInput(
      request,
      plan,
      baseCommit,
      prepared.resolved,
      criteria,
    )
    const inputHash = buildInputHash(resolvedInput)

    const reusable = this.store.findReusableIntegrationRun(projectId, planId, inputHash)
    if (reusable) {
      const manifest = this.store.getIntegrationManifestByRun(reusable.id)
      return {
        status: 'SUCCEEDED',
        run: reusable,
        modules: this.store.listIntegrationModules(reusable.id),
        adapters: this.store.listIntegrationAdapters(reusable.id),
        conflicts: this.store.listIntegrationConflicts(reusable.id),
        ...(manifest ? { manifest } : {}),
        reused: true,
      }
    }
    if (!['RUNNING', 'INTEGRATING'].includes(project.status)) {
      throw new ConflictError(`Project is ${project.status}; integration requires RUNNING`)
    }

    const structural = prepared.issues.filter((issue) => issue.type === 'STRUCTURAL')
    if (structural.length > 0 || prepared.resolved.length === 0) {
      return this.failBeforeAssembly({
        principal,
        project,
        plan,
        request,
        baseCommit,
        inputHash,
        prepared,
        criteria,
        status: 'STRUCTURAL_FAILED',
      })
    }
    if (prepared.issues.some((issue) => issue.type === 'MINOR' && !issue.resolution)) {
      return this.failBeforeAssembly({
        principal,
        project,
        plan,
        request,
        baseCommit,
        inputHash,
        prepared,
        criteria,
        status: 'FAILED',
      })
    }

    const attempt = this.store.latestIntegrationAttempt(projectId, planId, inputHash) + 1
    const workspaceName = `integration-${inputHash.slice(0, 12)}-${attempt}`
    const integrationPath = join(this.options.worktreeRoot, 'integrations', workspaceName)
    const run = this.store.transaction(() => {
      const created = this.store.createIntegrationRun({
        projectId,
        planId,
        attempt,
        baseCommit,
        integrationPath,
        inputHash,
      })
      for (const module of prepared.resolved) {
        this.store.createIntegrationModule({
          runId: created.id,
          moduleId: module.module.id,
          moduleVersionId: module.version.id,
          commitSha: module.version.commitSha,
          artifactHash: module.version.artifactHash,
          contractId: module.contract.id,
          status: 'INCLUDED',
        })
      }
      this.store.updateProjectStatus(project.id, 'INTEGRATING', project.version)
      this.emit(
        projectId,
        'integration.started',
        'integration_run',
        created.id,
        principal.subjectId,
        {
          runId: created.id,
          planId,
          baseCommit,
          inputHash,
          modules: prepared.resolved.map((module) => module.module.id),
        },
      )
      return created
    })

    try {
      return await this.assembleAndTest({
        principal,
        project,
        plan,
        request,
        baseCommit,
        inputHash,
        resolvedInput,
        prepared,
        run,
      })
    } catch (error) {
      const issue: IntegrationIssue = {
        type: error instanceof WorktreeError ? 'STRUCTURAL' : 'MINOR',
        code:
          error instanceof WorktreeError ? 'INTEGRATION_WORKSPACE_ERROR' : 'INTEGRATION_EXCEPTION',
        message: error instanceof Error ? error.message : String(error),
        modules: prepared.resolved.map((module) => module.module.id),
        evidence: [
          redactText(error instanceof Error ? (error.stack ?? error.message) : String(error)),
        ],
      }
      return this.persistFailure({
        principal,
        project: this.store.getProject(projectId)!,
        plan,
        run,
        issues: [issue],
        status: issue.type === 'STRUCTURAL' ? 'STRUCTURAL_FAILED' : 'FAILED',
        resolved: prepared.resolved,
      })
    }
  }

  listRuns(projectId: ProjectId): IntegrationRunRecord[] {
    return this.store.listIntegrationRuns(projectId)
  }

  listManifests(projectId: ProjectId): IntegrationManifestRecord[] {
    return this.store.listIntegrationManifests(projectId)
  }

  getManifest(id: string): IntegrationManifestRecord {
    const manifest = this.store.getIntegrationManifest(id)
    if (!manifest) throw new NotFoundError(`Integration manifest ${id} not found`)
    return manifest
  }

  private async assembleAndTest(input: {
    readonly principal: Principal
    readonly project: Project
    readonly plan: Plan
    readonly request: IntegrationRequest
    readonly baseCommit: string
    readonly inputHash: string
    readonly resolvedInput: ResolvedIntegrationInput
    readonly prepared: PreparedIntegration
    readonly run: IntegrationRunRecord
  }): Promise<IntegrationResult> {
    const {
      principal,
      project,
      plan,
      request,
      baseCommit,
      inputHash,
      resolvedInput,
      prepared,
      run,
    } = input
    const workspace = this.workspace.prepare(run.integrationPath.split(/[\\/]/).pop()!, baseCommit)
    const issues: IntegrationIssue[] = []
    for (const module of prepared.resolved) {
      this.workspace.applyModule(workspace, module.version.commitSha, module.roots)
    }
    for (const file of Object.entries(request.testFiles)) {
      this.workspace.writeFile(workspace, file[0], file[1])
    }

    const adapterTests = new Map<string, TestCommandResult[]>()
    for (const adapter of request.adapters) {
      for (const [path, content] of Object.entries(adapter.files)) {
        this.workspace.writeFile(workspace, path, content)
      }
      const results = this.workspace.runTests(workspace, adapter.tests, this.options.testsTimeoutMs)
      adapterTests.set(adapter.path, results)
      const failed = results.find((result) => !result.passed)
      if (failed) {
        issues.push({
          type: 'MINOR',
          code: 'ADAPTER_TEST_FAILED',
          message: `Adapter ${adapter.path} failed its own tests`,
          modules: [adapter.moduleId],
          evidence: testEvidence(failed),
        })
      }
    }
    if (issues.length > 0) {
      return this.persistFailure({
        principal,
        project: this.store.getProject(project.id)!,
        plan,
        run,
        issues,
        status: 'FAILED',
        resolved: prepared.resolved,
      })
    }

    const integrationTests = this.workspace.runTests(
      workspace,
      request.integrationTests,
      this.options.testsTimeoutMs,
    )
    const failedIntegration = integrationTests.find((result) => !result.passed)
    if (failedIntegration) {
      return this.persistFailure({
        principal,
        project: this.store.getProject(project.id)!,
        plan,
        run,
        issues: [
          {
            type: 'MINOR',
            code: 'INTEGRATION_TEST_FAILED',
            message: `Integration test failed: ${failedIntegration.command}`,
            modules: prepared.resolved.map((module) => module.module.id),
            evidence: testEvidence(failedIntegration),
          },
        ],
        status: 'FAILED',
        resolved: prepared.resolved,
      })
    }

    const authoredFiles = new Map<string, string>([
      ...Object.entries(request.testFiles),
      ...request.adapters.flatMap((adapter) => Object.entries(adapter.files)),
    ])
    for (const [path, expected] of authoredFiles) {
      let actual: string
      try {
        actual = this.workspace.readFile(workspace, path)
      } catch (error) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'AUTHORED_FILE_DELETED',
          message: `Integration tests deleted an authored file: ${path}`,
          modules: prepared.resolved.map((module) => module.module.id),
          evidence: [error instanceof Error ? error.message : String(error)],
        })
        continue
      }
      if (actual !== expected) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'AUTHORED_FILE_MODIFIED',
          message: `Integration tests modified an authored file after validation: ${path}`,
          modules: prepared.resolved.map((module) => module.module.id),
          evidence: [path, sha256(expected), sha256(actual)],
        })
      }
    }

    for (const module of prepared.resolved) {
      for (const root of module.roots) {
        if (this.workspace.differsFromCommit(workspace, module.version.commitSha, root)) {
          issues.push({
            type: 'STRUCTURAL',
            code: 'MODULE_MODIFIED_DURING_INTEGRATION',
            message: `Module ${module.module.name} changed after assembly`,
            modules: [module.module.id],
            evidence: [`commit=${module.version.commitSha}`, `root=${root}`],
          })
        }
      }
    }
    const allowedPaths = [
      ...prepared.resolved.flatMap((module) => module.roots.map((root) => `${root}/**`)),
      'integration/tests/**',
      'integration/adapters/**',
    ]
    const unexpected = this.workspace
      .changedPaths(workspace)
      .filter((path) => !allowedPaths.some((pattern) => matchesAllowedPath(path, pattern)))
    if (unexpected.length > 0) {
      issues.push({
        type: 'STRUCTURAL',
        code: 'UNEXPECTED_WORKSPACE_CHANGE',
        message: 'Integration produced changes outside modules, adapters and tests',
        modules: prepared.resolved.map((module) => module.module.id),
        evidence: unexpected.slice(0, 20),
      })
    }
    if (issues.length > 0) {
      return this.persistFailure({
        principal,
        project: this.store.getProject(project.id)!,
        plan,
        run,
        issues,
        status: 'STRUCTURAL_FAILED',
        resolved: prepared.resolved,
      })
    }

    const chronologicalFloor = Math.max(
      Date.parse(plan.approvedAt ?? plan.createdAt),
      Date.parse(plan.createdAt),
      ...prepared.resolved.map((module) =>
        Math.max(Date.parse(module.approvedAt), Date.parse(module.version.createdAt)),
      ),
    )
    const epoch = deterministicCommitEpoch(inputHash, chronologicalFloor)
    const commit = this.workspace.commit(
      workspace,
      allowedPaths,
      `integration(${plan.id}): ${prepared.resolved.map((module) => module.module.name).join(', ')}`,
      `@${epoch} +0000`,
    )
    if (!this.workspace.commitExists(commit.commitSha, commit.treeHash)) {
      throw new WorktreeError('GIT_FAILED', 'Integration commit is not readable after creation')
    }

    const manifestModules: IntegrationManifestModule[] = prepared.resolved.map((module) => ({
      moduleId: module.module.id,
      moduleName: module.module.name,
      moduleVersionId: module.version.id,
      version: module.version.version,
      commitSha: module.version.commitSha,
      treeHash: module.version.treeHash,
      artifactHash: module.version.artifactHash,
      approvedModuleId: module.approvedModuleId,
      contractId: module.contract.id,
      contractHash: module.contract.hash,
      paths: [...module.roots],
      moduleTreeHash: module.snapshot.moduleTreeHash,
    }))
    const manifestAdapters: IntegrationManifestAdapter[] = request.adapters.map((adapter) => {
      const tests = adapterTests.get(adapter.path) ?? []
      return {
        moduleId: adapter.moduleId,
        path: adapter.path,
        version: adapter.version,
        specHash: buildAdapterSpecHash(adapter),
        filesHash: sha256(adapter.files),
        tests,
        review: {
          reviewedBy: 'integration-manager',
          reviewedAt: new Date(epoch * 1000).toISOString(),
          checks: [
            { code: 'path.authorized', passed: true },
            { code: 'module.logic.untouched', passed: true },
            {
              code: 'adapter.tests.passed',
              passed: tests.length > 0 && tests.every((t) => t.passed),
            },
            { code: 'adapter.versioned', passed: adapter.version > 0 },
          ],
          status: 'VALIDATED',
        },
      }
    })
    const manifestConflicts: IntegrationManifestConflict[] = prepared.issues
      .filter((issue) => issue.type === 'MINOR')
      .map((issue) => ({
        type: 'MINOR',
        code: issue.code,
        message: issue.message,
        modules: [...issue.modules],
        evidence: [...issue.evidence],
        ...(issue.resolution ? { resolution: issue.resolution } : {}),
      }))
    const manifest = buildManifest({
      resolved: resolvedInput,
      inputHash,
      integrationCommit: commit.commitSha,
      modules: manifestModules,
      adapters: manifestAdapters,
      integrationTests,
      conflicts: manifestConflicts,
      createdAt: new Date(epoch * 1000).toISOString(),
    })
    const hash = buildManifestHash(manifest)

    const stored = this.store.transaction(() => {
      const manifestRecord = this.store.createIntegrationManifest({
        projectId: project.id,
        planId: plan.id,
        runId: run.id,
        hash,
        baseCommit,
        manifest: manifest as unknown as Record<string, unknown>,
      })
      for (const conflict of manifestConflicts) {
        this.store.createIntegrationConflict({
          runId: run.id,
          type: conflict.type,
          code: conflict.code,
          message: conflict.message,
          modules: conflict.modules as ModuleId[],
          evidence: conflict.evidence,
          ...(conflict.resolution ? { resolution: conflict.resolution } : {}),
        })
      }
      for (const adapter of manifestAdapters) {
        this.store.createIntegrationAdapter({
          runId: run.id,
          moduleId: adapter.moduleId as ModuleId,
          path: adapter.path,
          commitSha: commit.commitSha,
          version: adapter.version,
          tests: adapter.tests,
          review: adapter.review,
          status: 'VALIDATED',
        })
      }
      for (const module of prepared.resolved) {
        const current = this.store.getModule(module.module.id)!
        if (current.status !== 'INTEGRATED') {
          this.store.updateModuleStatus(current.id, 'INTEGRATED')
        }
        const version = this.store.getModuleVersion(module.version.id)!
        if (version.status !== 'INTEGRATED') {
          this.store.updateModuleVersionStatus(version.id, 'INTEGRATED')
        }
        const task = this.store.getTask(module.contract.taskId)
        if (task && task.state === 'APPROVED') {
          this.store.updateTaskState(task.id, 'INTEGRATED')
          this.emit(project.id, 'task.integrated', 'task', task.id, principal.subjectId, {
            taskId: task.id,
            moduleId: module.module.id,
            integrationRunId: run.id,
          })
        }
        this.emit(
          project.id,
          'module.integrated',
          'module',
          module.module.id,
          principal.subjectId,
          {
            moduleId: module.module.id,
            moduleVersionId: module.version.id,
            commitSha: module.version.commitSha,
            integrationRunId: run.id,
            manifestHash: hash,
          },
        )
      }
      this.store.updateIntegrationRun(run.id, {
        status: 'SUCCEEDED',
        manifestHash: hash,
      })
      const currentProject = this.store.getProject(project.id)!
      if (canTransitionProject(currentProject.status, 'FEEDBACK')) {
        this.store.updateProjectStatus(currentProject.id, 'FEEDBACK', currentProject.version)
      }
      this.emit(
        project.id,
        'integration.succeeded',
        'integration_run',
        run.id,
        principal.subjectId,
        {
          runId: run.id,
          manifestId: manifestRecord.id,
          manifestHash: hash,
          integrationCommit: commit.commitSha,
          modules: manifestModules.length,
          adapters: manifestAdapters.length,
        },
      )
      return manifestRecord
    })

    return {
      status: 'SUCCEEDED',
      run: this.store.getIntegrationRun(run.id)!,
      modules: this.store.listIntegrationModules(run.id),
      adapters: this.store.listIntegrationAdapters(run.id),
      conflicts: this.store.listIntegrationConflicts(run.id),
      manifest: stored,
      reused: false,
    }
  }

  private failBeforeAssembly(input: {
    readonly principal: Principal
    readonly project: Project
    readonly plan: Plan
    readonly request: IntegrationRequest
    readonly baseCommit: string
    readonly inputHash: string
    readonly prepared: PreparedIntegration
    readonly criteria: readonly IntegrationCriterion[]
    readonly status: 'STRUCTURAL_FAILED' | 'FAILED'
  }): IntegrationResult {
    const attempt =
      this.store.latestIntegrationAttempt(input.project.id, input.plan.id, input.inputHash) + 1
    const workspaceName = `integration-${input.inputHash.slice(0, 12)}-${attempt}`
    const run = this.store.transaction(() => {
      const created = this.store.createIntegrationRun({
        projectId: input.project.id,
        planId: input.plan.id,
        attempt,
        baseCommit: input.baseCommit,
        integrationPath: join(this.options.worktreeRoot, 'integrations', workspaceName),
        inputHash: input.inputHash,
      })
      for (const module of input.prepared.resolved) {
        this.store.createIntegrationModule({
          runId: created.id,
          moduleId: module.module.id,
          moduleVersionId: module.version.id,
          commitSha: module.version.commitSha,
          artifactHash: module.version.artifactHash,
          contractId: module.contract.id,
          status: 'INCLUDED',
        })
      }
      return created
    })
    return this.persistFailure({
      principal: input.principal,
      project: input.project,
      plan: input.plan,
      run,
      issues: input.prepared.issues,
      status: input.status,
      resolved: input.prepared.resolved,
    })
  }

  private persistFailure(input: {
    readonly principal: Principal
    readonly project: Project
    readonly plan: Plan
    readonly run: IntegrationRunRecord
    readonly issues: readonly IntegrationIssue[]
    readonly status: 'STRUCTURAL_FAILED' | 'FAILED'
    readonly resolved: readonly ResolvedModule[]
  }): IntegrationResult {
    const issueList =
      input.issues.length > 0
        ? [...input.issues]
        : [
            {
              type: 'STRUCTURAL' as const,
              code: 'NO_USABLE_MODULES',
              message: 'No approved module could be selected for integration',
              modules: [],
              evidence: [],
            },
          ]
    this.store.transaction(() => {
      for (const issue of issueList) {
        this.store.createIntegrationConflict({
          runId: input.run.id,
          type: issue.type,
          code: issue.code,
          message: issue.message,
          modules: issue.modules as ModuleId[],
          evidence: issue.evidence,
          ...(issue.resolution ? { resolution: issue.resolution } : {}),
        })
      }
      this.store.updateIntegrationRun(input.run.id, {
        status: input.status,
        error: issueList
          .map((issue) => `${issue.code}: ${issue.message}`)
          .join('; ')
          .slice(0, 2000),
      })
      const project = this.store.getProject(input.project.id)
      if (project?.status === 'INTEGRATING' && canTransitionProject(project.status, 'RUNNING')) {
        this.store.updateProjectStatus(project.id, 'RUNNING', project.version)
      }
      this.sendCoordinatorReport(
        input.principal,
        input.project.id,
        input.run.id,
        input.plan.id,
        input.status,
        issueList,
      )
      this.emit(
        input.project.id,
        input.status === 'STRUCTURAL_FAILED'
          ? 'integration.structural_failed'
          : 'integration.failed',
        'integration_run',
        input.run.id,
        input.principal.subjectId,
        {
          runId: input.run.id,
          status: input.status,
          conflicts: issueList.map((issue) => issue.code),
        },
      )
    })
    return {
      status: input.status,
      run: this.store.getIntegrationRun(input.run.id)!,
      modules: this.store.listIntegrationModules(input.run.id),
      adapters: this.store.listIntegrationAdapters(input.run.id),
      conflicts: this.store.listIntegrationConflicts(input.run.id),
      reused: false,
    }
  }

  private prepareModules(
    request: IntegrationRequest,
    project: Project,
    plan: Plan,
    baseCommit: string,
    criteria: readonly IntegrationCriterion[],
  ): PreparedIntegration {
    const issues: IntegrationIssue[] = []
    const resolved: ResolvedModule[] = []
    const seen = new Set<string>()
    for (const requested of request.modules) {
      const module = this.findModule(project.id, requested.moduleId)
      if (!module) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'MODULE_NOT_FOUND',
          message: `Requested module not found: ${requested.moduleId}`,
          modules: [requested.moduleId],
          evidence: [],
        })
        continue
      }
      if (seen.has(module.id)) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'DUPLICATE_MODULE',
          message: `Module ${module.name} was requested more than once`,
          modules: [module.id],
          evidence: [module.id],
        })
        continue
      }
      seen.add(module.id)
      const version = requested.moduleVersionId
        ? this.store.getModuleVersion(requested.moduleVersionId as ModuleVersionId)
        : module.currentVersionId
          ? this.store.getModuleVersion(module.currentVersionId)
          : this.store.listModuleVersions(module.id)[0]
      if (!version || version.moduleId !== module.id) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'MODULE_VERSION_NOT_FOUND',
          message: `No immutable version available for ${module.name}`,
          modules: [module.id],
          evidence: [requested.moduleVersionId ?? 'current'],
        })
        continue
      }
      if (module.currentVersionId && module.currentVersionId !== version.id) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'STALE_MODULE_VERSION',
          message: `Module ${module.name} has a newer version; the requested version needs revalidation`,
          modules: [module.id],
          evidence: [`requested=${version.id}`, `current=${module.currentVersionId}`],
        })
        continue
      }
      const approved = this.store.getApprovedModuleByVersion(version.id)
      if (!approved) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'MODULE_NOT_APPROVED',
          message: `Module ${module.name} version ${version.version} is not approved`,
          modules: [module.id],
          evidence: [`moduleVersionId=${version.id}`, `status=${version.status}`],
        })
        continue
      }
      if (
        approved.commitSha !== version.commitSha ||
        approved.artifactHash !== version.artifactHash ||
        !['APPROVED', 'INTEGRATED'].includes(version.status)
      ) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'APPROVAL_MISMATCH',
          message: `Approval for ${module.name} does not match the immutable version`,
          modules: [module.id],
          evidence: [
            `approvedCommit=${approved.commitSha}`,
            `versionCommit=${version.commitSha}`,
            `versionStatus=${version.status}`,
          ],
        })
        continue
      }
      const artifact = sha256({ commitSha: version.commitSha, treeHash: version.treeHash })
      if (
        artifact !== version.artifactHash ||
        !this.workspace.commitExists(version.commitSha, version.treeHash)
      ) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'MODIFIED_AFTER_APPROVAL',
          message: `Module ${module.name} was modified or its commit/tree is not available`,
          modules: [module.id],
          evidence: [
            `expectedArtifact=${version.artifactHash}`,
            `computedArtifact=${artifact}`,
            `commit=${version.commitSha}`,
            `tree=${version.treeHash}`,
          ],
        })
        continue
      }
      const contract = this.resolveContract(module, project.id, requested.contractId)
      if (!contract) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'CONTRACT_MISSING',
          message: `Module ${module.name} has no active contract for integration`,
          modules: [module.id],
          evidence: [`moduleId=${module.id}`],
        })
        continue
      }
      let roots: string[]
      try {
        roots = [...new Set(module.pathScope.map(moduleRootFromScope))]
      } catch (error) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'MODULE_SCOPE_INVALID',
          message: `Module ${module.name} has an invalid path scope`,
          modules: [module.id],
          evidence: [error instanceof Error ? error.message : String(error)],
        })
        continue
      }
      const protectedRoot = roots.find((root) =>
        RESERVED_MODULE_PREFIXES.some((prefix) => root === prefix || root.startsWith(`${prefix}/`)),
      )
      if (protectedRoot) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'PROTECTED_MODULE_SCOPE',
          message: `Module ${module.name} targets a protected path`,
          modules: [module.id],
          evidence: [protectedRoot],
        })
        continue
      }
      let moduleTreeHash: string
      try {
        moduleTreeHash = roots
          .map((root) => `${root}=${this.workspace.treeAtPath(version.commitSha, root)}`)
          .join('|')
      } catch (error) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'MISSING_MODULE_CONTENT',
          message: `Module ${module.name} has no content at its approved commit`,
          modules: [module.id],
          evidence: [error instanceof Error ? error.message : String(error)],
        })
        continue
      }
      resolved.push({
        module,
        version,
        approvedModuleId: approved.id,
        approvedAt: approved.approvedAt,
        contract,
        roots,
        snapshot: {
          moduleId: module.id,
          moduleName: module.name,
          moduleVersionId: version.id,
          version: version.version,
          commitSha: version.commitSha,
          treeHash: version.treeHash,
          artifactHash: version.artifactHash,
          approvedModuleId: approved.id,
          contractId: contract.id,
          contractHash: contract.hash,
          paths: roots,
          moduleTreeHash,
        },
      })
    }

    this.validateRequiredModules(request, project, resolved, issues)
    this.validateDependencies(request, project, resolved, issues)
    this.validateModuleOverlap(resolved, issues)
    const interfaceResolutions = this.validateInterfaces(request, resolved, issues)
    this.validateAdapters(request, resolved, issues)
    this.validateTestFiles(request, resolved, issues)
    for (const criterion of criteria) {
      if (
        criterion.moduleId &&
        !resolved.some((module) => module.module.id === criterion.moduleId)
      ) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'CRITERION_MODULE_NOT_SELECTED',
          message: `Criterion ${criterion.id} references a module that is not part of the integration`,
          modules: [criterion.moduleId],
          evidence: [criterion.id],
        })
      }
    }
    if (!this.store.getProject(project.id)?.id) throw new NotFoundError('Project disappeared')
    if (!plan.id) throw new NotFoundError('Plan disappeared')
    if (!baseCommit) throw new ValidationError('Base commit is required')
    return { resolved, issues, interfaceResolutions }
  }

  private validateRequiredModules(
    request: IntegrationRequest,
    project: Project,
    resolved: readonly ResolvedModule[],
    issues: IntegrationIssue[],
  ): void {
    for (const reference of request.requiredModules) {
      const module = this.findModule(project.id, reference)
      if (!module) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'REQUIRED_MODULE_NOT_FOUND',
          message: `Required module does not exist: ${reference}`,
          modules: [reference],
          evidence: [],
        })
        continue
      }
      if (!resolved.some((candidate) => candidate.module.id === module.id)) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'MISSING_REQUIRED_MODULE',
          message: `Required module is not available as an approved version: ${module.name}`,
          modules: [module.id],
          evidence: [module.id],
        })
      }
    }
  }

  private validateDependencies(
    request: IntegrationRequest,
    project: Project,
    resolved: readonly ResolvedModule[],
    issues: IntegrationIssue[],
  ): void {
    const graph = new Map<string, Set<string>>()
    for (const module of resolved) graph.set(module.module.id, new Set())
    for (const [sourceReference, targets] of Object.entries(request.dependencies)) {
      const source = this.findModule(project.id, sourceReference)
      if (!source || !graph.has(source.id)) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'DEPENDENCY_SOURCE_NOT_SELECTED',
          message: `Dependency source is not part of the integration: ${sourceReference}`,
          modules: [sourceReference],
          evidence: targets,
        })
        continue
      }
      for (const targetReference of targets) {
        const target = this.findModule(project.id, targetReference)
        if (!target) {
          issues.push({
            type: 'STRUCTURAL',
            code: 'DEPENDENCY_NOT_FOUND',
            message: `Dependency does not exist: ${targetReference}`,
            modules: [source.id],
            evidence: [targetReference],
          })
          continue
        }
        if (!graph.has(target.id)) {
          issues.push({
            type: 'STRUCTURAL',
            code: 'MISSING_DEPENDENCY',
            message: `Module ${source.name} depends on ${target.name}, which is not selected`,
            modules: [source.id, target.id],
            evidence: [...targets],
          })
          continue
        }
        graph.get(source.id)!.add(target.id)
      }
    }
    const tasks = this.store.listTasks(project.id)
    const moduleByTask = new Map<string, string>()
    for (const task of tasks) if (task.moduleId) moduleByTask.set(task.id, task.moduleId)
    for (const dependency of this.store.listDependenciesForProject(project.id)) {
      const sourceModule = moduleByTask.get(dependency.taskId)
      const targetModule = moduleByTask.get(dependency.dependsOnTaskId)
      if (!sourceModule || !targetModule || sourceModule === targetModule) continue
      if (!graph.has(sourceModule)) continue
      if (!graph.has(targetModule)) {
        const target = this.store.getModule(targetModule as ModuleId)
        issues.push({
          type: 'STRUCTURAL',
          code: 'MISSING_DEPENDENCY',
          message: `Task dependency requires module ${target?.name ?? targetModule}, which is not selected`,
          modules: [sourceModule as ModuleId, targetModule as ModuleId],
          evidence: [dependency.taskId, dependency.dependsOnTaskId],
        })
        continue
      }
      graph.get(sourceModule)!.add(targetModule)
    }
    const cycle = findCycle(graph)
    if (cycle) {
      issues.push({
        type: 'STRUCTURAL',
        code: 'CIRCULAR_DEPENDENCY',
        message: `Circular module dependency: ${cycle.join(' -> ')}`,
        modules: cycle as ModuleId[],
        evidence: [cycle.join(' -> ')],
      })
    }
  }

  private validateModuleOverlap(
    resolved: readonly ResolvedModule[],
    issues: IntegrationIssue[],
  ): void {
    for (let left = 0; left < resolved.length; left += 1) {
      for (let right = left + 1; right < resolved.length; right += 1) {
        const first = resolved[left]!
        const second = resolved[right]!
        for (const firstRoot of first.roots) {
          for (const secondRoot of second.roots) {
            if (
              firstRoot === secondRoot ||
              firstRoot.startsWith(`${secondRoot}/`) ||
              secondRoot.startsWith(`${firstRoot}/`)
            ) {
              issues.push({
                type: 'STRUCTURAL',
                code: 'OVERLAPPING_MODULE_SCOPES',
                message: `Modules ${first.module.name} and ${second.module.name} overlap in the workspace`,
                modules: [first.module.id, second.module.id],
                evidence: [firstRoot, secondRoot],
              })
            }
          }
        }
      }
    }
  }

  private validateInterfaces(
    request: IntegrationRequest,
    resolved: readonly ResolvedModule[],
    issues: IntegrationIssue[],
  ): Map<string, IntegrationAdapterSpec> {
    const resolutions = new Map<string, IntegrationAdapterSpec>()
    for (const mapping of request.interfaceMappings) {
      const module = resolved.find((candidate) => candidate.module.id === mapping.moduleId)
      if (!module) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'INTERFACE_MODULE_NOT_SELECTED',
          message: `Interface mapping references ${mapping.moduleId}, which is not selected`,
          modules: [mapping.moduleId],
          evidence: [`expected=${mapping.expected}`, `provided=${mapping.provided}`],
        })
        continue
      }
      const declared = new Set([
        ...module.contract.inputInterfaces,
        ...module.contract.outputInterfaces,
      ])
      if (!declared.has(mapping.provided)) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'PROVIDED_INTERFACE_NOT_IN_CONTRACT',
          message: `Module ${module.module.name} does not declare provided interface ${mapping.provided}`,
          modules: [module.module.id],
          evidence: [`contract=${module.contract.id}`, ...[...declared]],
        })
        continue
      }
      if (mapping.expected === mapping.provided) continue
      const adapter = request.adapters.find((candidate) => candidate.moduleId === module.module.id)
      if (adapter) {
        resolutions.set(module.module.id, adapter)
        issues.push({
          type: 'MINOR',
          code: 'INTERFACE_NAME_MISMATCH',
          message: `Interface ${mapping.provided} from ${module.module.name} must be exposed as ${mapping.expected}`,
          modules: [module.module.id],
          evidence: [
            `expected=${mapping.expected}`,
            `provided=${mapping.provided}`,
            `contract=${module.contract.id}`,
          ],
          resolution: `${adapter.path}@v${adapter.version}`,
        })
      } else {
        issues.push({
          type: 'MINOR',
          code: 'ADAPTER_REQUIRED',
          message: `Minor incompatibility in ${module.module.name}: ${mapping.provided} must be exposed as ${mapping.expected}`,
          modules: [module.module.id],
          evidence: [`expected=${mapping.expected}`, `provided=${mapping.provided}`],
        })
      }
    }
    return resolutions
  }

  private validateAdapters(
    request: IntegrationRequest,
    resolved: readonly ResolvedModule[],
    issues: IntegrationIssue[],
  ): void {
    const seenPaths = new Set<string>()
    for (const rawAdapter of request.adapters) {
      const parsed = IntegrationAdapterSpecSchema.safeParse(rawAdapter)
      if (!parsed.success) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'ADAPTER_SPEC_INVALID',
          message: 'Adapter specification is invalid',
          modules: [rawAdapter.moduleId],
          evidence: parsed.error.issues.map((issue) => issue.message),
        })
        continue
      }
      const adapter = parsed.data
      const module = resolved.find((candidate) => candidate.module.id === adapter.moduleId)
      if (!module) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'ADAPTER_MODULE_NOT_SELECTED',
          message: `Adapter ${adapter.path} targets a module that is not selected`,
          modules: [adapter.moduleId],
          evidence: [adapter.path],
        })
        continue
      }
      if (seenPaths.has(adapter.path)) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'ADAPTER_DUPLICATED',
          message: `Adapter path is duplicated: ${adapter.path}`,
          modules: [adapter.moduleId],
          evidence: [adapter.path],
        })
        continue
      }
      seenPaths.add(adapter.path)
      const normalized = Object.keys(adapter.files).map(normalizePath)
      if (!normalized.includes(normalizePath(adapter.path))) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'ADAPTER_FILE_MISSING',
          message: `Adapter entrypoint is not among its versioned files: ${adapter.path}`,
          modules: [adapter.moduleId],
          evidence: normalized,
        })
      }
      for (const path of normalized) {
        if (!path.startsWith('integration/adapters/')) {
          issues.push({
            type: 'STRUCTURAL',
            code: 'ADAPTER_PATH_NOT_ALLOWED',
            message: `Adapter may only write under integration/adapters/: ${path}`,
            modules: [adapter.moduleId],
            evidence: [path],
          })
        }
        if (path.split('/').includes('..') || path.startsWith('/')) {
          issues.push({
            type: 'STRUCTURAL',
            code: 'ADAPTER_PATH_TRAVERSAL',
            message: `Adapter path escapes its authorized root: ${path}`,
            modules: [adapter.moduleId],
            evidence: [path],
          })
        }
        if (module.roots.some((root) => path === root || path.startsWith(`${root}/`))) {
          issues.push({
            type: 'STRUCTURAL',
            code: 'ADAPTER_OVERLAPS_MODULE',
            message: `Adapter writes inside an approved module: ${path}`,
            modules: [adapter.moduleId],
            evidence: [path],
          })
        }
      }
      for (const command of adapter.tests) {
        const parts = command.trim().split(/\s+/)
        const script = parts[1] ? normalizePath(parts[1]) : ''
        if (parts[0] !== 'node' || !script) {
          issues.push({
            type: 'STRUCTURAL',
            code: 'ADAPTER_TEST_COMMAND_UNSAFE',
            message: `Adapter tests must use "node <script>": ${command}`,
            modules: [adapter.moduleId],
            evidence: [command],
          })
        } else if (!normalized.includes(script)) {
          issues.push({
            type: 'STRUCTURAL',
            code: 'ADAPTER_TEST_NOT_VERSIONED',
            message: `Adapter test file is not part of the adapter artifact: ${script}`,
            modules: [adapter.moduleId],
            evidence: [command, ...normalized],
          })
        }
      }
      for (const [path, content] of Object.entries(adapter.files)) {
        if (content.length > 200_000) {
          issues.push({
            type: 'STRUCTURAL',
            code: 'ADAPTER_FILE_TOO_LARGE',
            message: `Adapter file exceeds 200 KB: ${path}`,
            modules: [adapter.moduleId],
            evidence: [path],
          })
        }
      }
    }
  }

  private validateTestFiles(
    request: IntegrationRequest,
    resolved: readonly ResolvedModule[],
    issues: IntegrationIssue[],
  ): void {
    for (const [path, content] of Object.entries(request.testFiles)) {
      const normalized = normalizePath(path)
      if (!normalized.startsWith('integration/tests/')) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'INTEGRATION_TEST_PATH_NOT_ALLOWED',
          message: `Integration test file must live under integration/tests/: ${path}`,
          modules: resolved.map((module) => module.module.id),
          evidence: [path],
        })
      }
      if (normalized.includes('../') || normalized.startsWith('/')) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'INTEGRATION_TEST_PATH_TRAVERSAL',
          message: `Integration test path escapes its root: ${path}`,
          modules: resolved.map((module) => module.module.id),
          evidence: [path],
        })
      }
      if (
        resolved.some((module) => module.roots.some((root) => normalized.startsWith(`${root}/`)))
      ) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'INTEGRATION_TEST_OVERLAPS_MODULE',
          message: `Integration test writes inside an approved module: ${path}`,
          modules: resolved.map((module) => module.module.id),
          evidence: [path],
        })
      }
      if (content.length > 500_000) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'INTEGRATION_TEST_TOO_LARGE',
          message: `Integration test file exceeds 500 KB: ${path}`,
          modules: resolved.map((module) => module.module.id),
          evidence: [path],
        })
      }
    }
    for (const command of request.integrationTests) {
      if (!command.trim().startsWith('node ')) {
        issues.push({
          type: 'STRUCTURAL',
          code: 'INTEGRATION_TEST_COMMAND_UNSAFE',
          message: `Integration tests must use "node <script>": ${command}`,
          modules: resolved.map((module) => module.module.id),
          evidence: [command],
        })
      }
    }
  }

  private toResolvedInput(
    request: IntegrationRequest,
    plan: Plan,
    baseCommit: string,
    resolved: readonly ResolvedModule[],
    criteria: readonly IntegrationCriterion[],
  ): ResolvedIntegrationInput {
    return {
      projectId: request.projectId,
      planId: request.planId,
      planHash: plan.hash,
      baseCommit,
      requiredModules: request.requiredModules,
      dependencies: request.dependencies,
      modules: resolved.map((module) => module.snapshot),
      adapters: request.adapters,
      integrationTests: request.integrationTests,
      testFiles: request.testFiles,
      criteria,
      interfaceMappings: request.interfaceMappings,
    }
  }

  private resolveCriteria(
    plan: Plan,
    request: IntegrationRequest,
  ): readonly IntegrationCriterion[] {
    if (request.criteria.length > 0) return request.criteria
    const raw = plan.spec['acceptanceCriteria']
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((item, index) => {
        if (typeof item === 'string') {
          return {
            id: `AC-${index + 1}`,
            description: item,
            required: true,
          }
        }
        if (
          item &&
          typeof item === 'object' &&
          typeof (item as Record<string, unknown>)['id'] === 'string'
        ) {
          const record = item as Record<string, unknown>
          return {
            id: String(record['id']),
            description: String(record['description'] ?? record['id']),
            required: record['required'] !== false,
            ...(typeof record['moduleId'] === 'string' ? { moduleId: record['moduleId'] } : {}),
          }
        }
        return {
          id: `AC-${index + 1}`,
          description: JSON.stringify(item),
          required: true,
        }
      })
    }
    return request.integrationTests.map((command, index) => ({
      id: `AC-${index + 1}`,
      description: `La prueba de integración debe pasar: ${command}`,
      required: true,
    }))
  }

  private resolveContract(
    module: Module,
    projectId: ProjectId,
    contractId?: string,
  ): Contract | undefined {
    if (contractId) {
      const contract = this.store.getContract(contractId as never)
      if (contract && contract.moduleId === module.id && contract.status === 'ACTIVE') {
        const task = this.store.getTask(contract.taskId)
        if (task && ['APPROVED', 'INTEGRATED'].includes(task.state)) return contract
      }
    }
    const approvedTasks = this.store
      .listTasks(projectId)
      .filter(
        (task) =>
          task.moduleId === module.id &&
          task.contractId &&
          ['APPROVED', 'INTEGRATED'].includes(task.state),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    for (const task of approvedTasks) {
      const contract = this.store.getContract(task.contractId as never)
      if (contract && contract.moduleId === module.id && contract.status === 'ACTIVE') {
        return contract
      }
    }
    return undefined
  }

  private findModule(projectId: ProjectId, reference: string): Module | undefined {
    const byId = this.store.getModule(reference as ModuleId)
    if (byId && byId.projectId === projectId) return byId
    return this.store.listModules(projectId).find((module) => module.name === reference)
  }

  private resolveBaseCommit(ref: string): string {
    try {
      const commit = this.workspace.resolveCommit(ref)
      if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error(`Invalid commit: ${commit}`)
      return commit
    } catch (error) {
      throw new ValidationError(
        `Cannot resolve integration base ${ref}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private sendCoordinatorReport(
    principal: Principal,
    projectId: ProjectId,
    runId: string,
    planId: PlanId,
    status: string,
    issues: readonly IntegrationIssue[],
  ): void {
    const coordinator = this.store.getAgentByOpenCodeId(projectId, 'coordinador')
    const integrator =
      (principal.agentId ? this.store.getAgent(principal.agentId as AgentId) : undefined) ??
      this.store.getAgentByOpenCodeId(projectId, 'integrador')
    if (!coordinator || !integrator) return
    const payload = {
      kind: 'IntegrationReport',
      runId,
      planId,
      status,
      conflicts: issues.map((issue) => ({
        type: issue.type,
        code: issue.code,
        message: issue.message,
        modules: issue.modules,
        evidence: issue.evidence,
      })),
      requestedAction:
        status === 'STRUCTURAL_FAILED'
          ? 'Coordinar correcciones en los modulos afectados y emitir nuevas versiones aprobadas.'
          : 'Revisar el adaptador o las pruebas de integracion antes de reintentar.',
    }
    this.store.createMessage({
      projectId,
      fromAgentId: integrator.id,
      toAgentId: coordinator.id,
      correlationId: `integration:${runId}`,
      kind: 'INFO',
      priority: 90,
      payload,
      requiresApproval: false,
      idempotencyKey: `integration-report:${runId}`,
    })
    this.emit(projectId, 'integration.report.sent', 'integration_run', runId, integrator.id, {
      runId,
      toAgentId: coordinator.id,
      conflicts: issues.length,
    })
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
    this.store.appendOutbox(event.id, 'orchestrator.integration', {
      eventId: event.id,
      type: event.type,
      aggregateId: event.aggregateId,
    })
  }
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\/+/, '')
}

function testEvidence(result: TestCommandResult): string[] {
  return [
    `command=${result.command}`,
    `exit=${result.exitCode}`,
    `durationMs=${result.durationMs}`,
    `stdout=${redactText(result.stdout).slice(0, 4000)}`,
    `stderr=${redactText(result.stderr).slice(0, 4000)}`,
  ]
}

function findCycle(graph: ReadonlyMap<string, Set<string>>): string[] | undefined {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const visit = (node: string): string[] | undefined => {
    if (visiting.has(node)) {
      const index = stack.indexOf(node)
      return [...stack.slice(index), node]
    }
    if (visited.has(node)) return undefined
    visiting.add(node)
    stack.push(node)
    for (const target of graph.get(node) ?? []) {
      const cycle = visit(target)
      if (cycle) return cycle
    }
    stack.pop()
    visiting.delete(node)
    visited.add(node)
    return undefined
  }
  for (const node of graph.keys()) {
    const cycle = visit(node)
    if (cycle) return cycle
  }
  return undefined
}

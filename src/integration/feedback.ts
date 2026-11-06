import type { AppConfig } from '../config/env.js'
import { parseModelRef } from '../config/env.js'
import type { Plan, Review } from '../domain/index.js'
import type { AgentId, ModuleId, ProjectId } from '../domain/ids.js'
import { canTransitionProject } from '../domain/transitions.js'
import type { AuthorizationService } from '../auth/authorization.js'
import type { Principal } from '../auth/types.js'
import type {
  FinalDeliveryRecord,
  FeedbackRunRecord,
  IntegrationManifestRecord,
  SqliteStore,
} from '../persistence/store.js'
import type { SessionManager } from '../sessions/manager.js'
import { sha256 } from '../security/hash.js'
import { signArtifact } from '../security/signatures.js'
import { redactText } from '../security/redaction.js'
import type { WorktreeManager } from '../worktrees/manager.js'
import { ConflictError, NotFoundError } from '../orchestrator/errors.js'
import {
  FeedbackReportSchema,
  IntegrationManifestSchema,
  type FeedbackFinding,
  type FeedbackGateCheck,
  type FeedbackReport,
  type StoredFeedbackReport,
  type IntegrationCriterion,
  type IntegrationManifest,
} from './contracts.js'
import { REVIEW_ROLES } from '../jury/verdict.js'
import { buildManifestHash } from './manifest.js'

export interface FeedbackExecutionInput {
  readonly projectId: ProjectId
  readonly plan: Plan
  readonly manifest: IntegrationManifestRecord
  readonly snapshotPath: string
  readonly criteria: readonly IntegrationCriterion[]
  readonly reviews: readonly Review[]
}

export interface FeedbackExecutor {
  run(input: FeedbackExecutionInput): Promise<FeedbackReport>
}

export interface FeedbackResult {
  readonly feedback: FeedbackRunRecord
  readonly delivery?: FinalDeliveryRecord
  readonly reused: boolean
  readonly affectedModules: readonly string[]
  readonly reworkTaskIds: readonly string[]
}

export class OpenCodeFeedbackExecutor implements FeedbackExecutor {
  constructor(
    private readonly store: SqliteStore,
    private readonly sessions: SessionManager,
    private readonly config: AppConfig,
  ) {}

  async run(input: FeedbackExecutionInput): Promise<FeedbackReport> {
    const agent = this.store.getAgentByOpenCodeId(input.projectId, 'feedback')
    if (!agent) throw new Error('Feedback agent not found')
    const model = parseModelRef(this.config.ORCH_AGENT_MODEL ?? this.config.OPENCODE_MODEL)
    const session = await this.sessions.createReadOnlySession({
      projectId: input.projectId,
      agent,
      directory: input.snapshotPath,
      title: `Feedback global - ${input.manifest.hash.slice(0, 16)}`,
      metadata: {
        role: 'FEEDBACK',
        manifestId: input.manifest.id,
        planId: input.plan.id,
      },
      ...(model ? { model } : {}),
    })
    try {
      await this.sessions.prompt(session.record, this.prompt(input))
      const transcript = await this.sessions.wait(
        session.record,
        this.config.ORCH_FEEDBACK_TIMEOUT_MS,
      )
      const text =
        [...transcript].reverse().find((message) => message.role === 'assistant')?.text ?? ''
      return this.parse(text)
    } catch (error) {
      throw new Error(
        `Feedback agent failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }

  private prompt(input: FeedbackExecutionInput): string {
    const manifest = input.manifest.manifest
    const tests = Array.isArray(manifest['integrationTests'])
      ? (manifest['integrationTests'] as Array<Record<string, unknown>>)
      : []
    return [
      'Eres el agente Feedback global. Evalua el producto integrado contra el plan humano aprobado.',
      'Acceso de solo lectura. No modifiques archivos, no ejecutes shell y no uses subagentes.',
      `Proyecto: ${input.projectId}`,
      `Snapshot integrado: ${input.snapshotPath}`,
      `Plan: ${input.plan.id}`,
      `Plan hash: ${input.plan.hash}`,
      `Manifiesto: ${input.manifest.id}`,
      `Manifiesto hash: ${input.manifest.hash}`,
      '',
      'Plan aprobado:',
      JSON.stringify(input.plan, null, 2).slice(0, 20_000),
      '',
      'Manifiesto de integracion:',
      JSON.stringify(manifest, null, 2).slice(0, 60_000),
      '',
      'Criterios obligatorios:',
      JSON.stringify(input.criteria, null, 2),
      '',
      'Evidencia de pruebas de integracion:',
      tests
        .map(
          (test) =>
            `- ${String(test['command'])}: ${test['passed'] === true ? 'PASS' : 'FAIL'} (exit ${String(test['exitCode'])})\nSTDOUT: ${redactText(String(test['stdout'] ?? '')).slice(0, 2000)}\nSTDERR: ${redactText(String(test['stderr'] ?? '')).slice(0, 2000)}`,
        )
        .join('\n') || '(sin pruebas)',
      '',
      'Dictamenes de los jueces:',
      JSON.stringify(
        input.reviews.map((review) => ({
          role: review.judgeRole,
          verdict: review.verdict,
          findings: review.findings,
          evidence: review.evidence,
          hash: review.hash,
        })),
        null,
        2,
      ),
      '',
      'Evalua requisitos funcionales, criterios de aceptacion, interfaces, pruebas extremo a extremo,',
      'restricciones no funcionales y evidencia de integracion. No aceptes afirmaciones sin evidencia.',
      'Evalua exclusivamente el plan aprobado, los criterios obligatorios, las interfaces y la evidencia de integracion registrada.',
      'Las puertas de CI del repositorio (npm run check, prettier, eslint, typecheck, build) no forman parte',
      'del snapshot de integracion salvo que esten listadas como pruebas o criterios. Si las observas,',
      'registralas como INFO o MINOR no bloqueante; no las conviertas en MAJOR/CRITICAL.',
      'Cada criterio PASS debe incluir al menos una evidencia verificable (ruta, comando o resultado).',
      'Un requisito incumplido, ausente o sin evidencia debe ser FAIL.',
      'Solo puedes devolver PASS si todos los criterios obligatorios cumplen con evidencia.',
      '',
      'Devuelve EXCLUSIVAMENTE un JSON valido, sin Markdown, con esta forma:',
      JSON.stringify(
        {
          verdict: 'PASS|FAIL',
          criteria: [
            {
              id: 'AC-1',
              status: 'PASS|FAIL',
              evidence: ['string'],
              notes: 'string',
            },
          ],
          findings: [
            {
              id: 'string',
              severity: 'INFO|MINOR|MAJOR|CRITICAL',
              message: 'string',
              moduleId: 'string',
              criterionId: 'string',
              requestedAction: 'string',
              evidence: ['string'],
            },
          ],
          summary: 'string',
          readyForFinalDelivery: true,
        },
        null,
        2,
      ),
    ].join('\n')
  }

  private parse(text: string): FeedbackReport {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('Feedback response did not contain JSON')
    let parsed: unknown
    try {
      parsed = JSON.parse(text.slice(start, end + 1))
    } catch (error) {
      throw new Error(
        `Feedback response JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
    return FeedbackReportSchema.parse(parsed)
  }
}

export class FeedbackService {
  constructor(
    private readonly store: SqliteStore,
    private readonly authz: AuthorizationService,
    private readonly worktrees: WorktreeManager,
    private readonly executor: FeedbackExecutor,
    private readonly signingSecret?: string,
  ) {}

  async run(principal: Principal, manifestId: string): Promise<FeedbackResult> {
    const manifestRecord = this.store.getIntegrationManifest(manifestId)
    if (!manifestRecord) throw new NotFoundError(`Integration manifest ${manifestId} not found`)
    this.authz.require(principal, 'feedback.submit', {
      type: 'project',
      id: manifestRecord.projectId,
    })
    const existing = this.store.getFeedbackRunByManifest(manifestId)
    if (existing) {
      return {
        feedback: existing,
        ...(this.store.getFinalDeliveryByManifest(manifestId)
          ? { delivery: this.store.getFinalDeliveryByManifest(manifestId)! }
          : {}),
        reused: true,
        affectedModules: Array.isArray(existing.report['affectedModules'])
          ? (existing.report['affectedModules'] as string[])
          : [],
        reworkTaskIds: [],
      }
    }
    const project = this.store.getProject(manifestRecord.projectId)
    if (!project) throw new NotFoundError('Project not found')
    const plan = this.store.getPlan(manifestRecord.planId)
    if (!plan) throw new NotFoundError('Plan not found')
    if (project.status !== 'FEEDBACK') {
      throw new ConflictError(`Project is ${project.status}; feedback requires FEEDBACK`)
    }

    const feedback = this.store.createFeedbackRun({
      projectId: project.id,
      planId: plan.id,
      manifestId,
      report: { status: 'running', manifestHash: manifestRecord.hash },
      hash: sha256({ manifestHash: manifestRecord.hash, planHash: plan.hash, status: 'running' }),
    })

    const checks: FeedbackGateCheck[] = []
    let manifest: IntegrationManifest | undefined
    try {
      manifest = IntegrationManifestSchema.parse(manifestRecord.manifest)
      checks.push(check('manifest.schema', true, 'Manifest schema is valid'))
      const recomputed = buildManifestHash(manifest)
      checks.push(
        check(
          'manifest.hash',
          recomputed === manifestRecord.hash,
          recomputed === manifestRecord.hash
            ? 'Manifest hash matches its content'
            : `Manifest hash mismatch: ${recomputed} != ${manifestRecord.hash}`,
        ),
      )
      checks.push(
        check(
          'plan.approved',
          plan.status === 'APPROVED' && plan.hash === manifest.planHash,
          plan.status === 'APPROVED' && plan.hash === manifest.planHash
            ? 'Plan is approved and matches manifest'
            : 'Plan is not approved or its hash changed',
        ),
      )
      const run = this.store.getIntegrationRun(manifestRecord.runId)
      checks.push(
        check(
          'integration.succeeded',
          run?.status === 'SUCCEEDED',
          `Integration run status: ${run?.status ?? 'missing'}`,
        ),
      )
      checks.push(
        check(
          'integration.input',
          Boolean(
            run && run.inputHash === manifest.inputHash && run.manifestHash === manifestRecord.hash,
          ),
          run
            ? `run.inputHash=${run.inputHash}; manifest.inputHash=${manifest.inputHash}; run.manifestHash=${run.manifestHash ?? 'missing'}`
            : 'Integration run is missing',
        ),
      )
      checks.push(
        check(
          'integration.tests',
          manifest.integrationTests.length > 0 &&
            manifest.integrationTests.every((test) => test.passed),
          `${manifest.integrationTests.filter((test) => test.passed).length}/${manifest.integrationTests.length} integration tests passed`,
        ),
      )
      const moduleChecks = this.verifyManifestModules(manifest)
      checks.push(...moduleChecks)
      const reviews = manifest.modules.flatMap((module) =>
        this.store.listReviewsForVersion(module.moduleVersionId as never),
      )
      checks.push(this.verifyReviews(manifest, reviews))
      const snapshot = this.worktrees.createDetached(
        `feedback-${manifestRecord.id}`,
        manifest.integrationCommit,
      )
      const report = await this.executor.run({
        projectId: project.id,
        plan,
        manifest: manifestRecord,
        snapshotPath: snapshot.path,
        criteria: manifest.criteria,
        reviews,
      })
      const gate = evaluateFeedbackReport(report, manifest.criteria, checks)
      checks.push(...gate.checks)
      const affectedModules = collectAffectedModules(report, manifest)
      const finalVerdict = gate.verdict
      const storedReport: StoredFeedbackReport = {
        ...report,
        verdict: finalVerdict,
        findings: [...report.findings, ...gate.findings],
        readyForFinalDelivery: finalVerdict === 'PASS' && report.readyForFinalDelivery,
        planHash: plan.hash,
        manifestHash: manifestRecord.hash,
        checks,
        affectedModules,
        agentReport: report,
        deterministicVerdict: finalVerdict,
      }
      return this.persistResult({
        principal,
        project,
        plan,
        manifestRecord,
        manifest,
        feedback,
        report: storedReport,
        verdict: finalVerdict,
        affectedModules,
        reworkTaskIds: [],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      checks.push(check('feedback.valid-report', false, message))
      const failedReport: StoredFeedbackReport = {
        verdict: 'FAIL',
        criteria: ((manifest?.criteria ?? []) as IntegrationCriterion[]).map((criterion) => ({
          id: criterion.id,
          status: 'FAIL',
          evidence: [],
          notes: 'No se pudo obtener un informe valido del agente Feedback',
        })),
        findings: [
          {
            id: 'feedback-unavailable',
            severity: 'CRITICAL',
            message: `El agente Feedback no emitio un informe valido: ${redactText(message)}`,
            requestedAction: 'Revisar la sesion de feedback y reintentar la evaluacion global.',
            evidence: [],
          },
        ],
        summary: 'Feedback no disponible; no se autoriza la entrega final.',
        readyForFinalDelivery: false,
        planHash: plan.hash,
        manifestHash: manifestRecord.hash,
        checks,
        affectedModules: [],
        deterministicVerdict: 'FAIL',
      }
      return this.persistResult({
        principal,
        project,
        plan,
        manifestRecord,
        manifest,
        feedback,
        report: failedReport,
        verdict: 'FAIL',
        affectedModules: [],
        reworkTaskIds: [],
      })
    }
  }

  private verifyManifestModules(manifest: IntegrationManifest): FeedbackGateCheck[] {
    const checks: FeedbackGateCheck[] = []
    for (const item of manifest.modules) {
      const version = this.store.getModuleVersion(item.moduleVersionId as never)
      const approved = this.store.getApprovedModuleByVersion(item.moduleVersionId as never)
      const commitAvailable = this.worktrees.resolveCommit(item.commitSha) === item.commitSha
      const tree = commitAvailable ? this.worktrees.treeOfCommit(item.commitSha) : ''
      checks.push(
        check(
          `module.${item.moduleId}.approval`,
          Boolean(
            approved &&
            version &&
            approved.commitSha === item.commitSha &&
            approved.artifactHash === item.artifactHash &&
            version.artifactHash === item.artifactHash &&
            ['APPROVED', 'INTEGRATED'].includes(version.status),
          ),
          approved && version
            ? `Approved ${approved.id}; version ${version.status}; commit ${version.commitSha}`
            : `Module ${item.moduleName} has no valid approval`,
        ),
      )
      const module = this.store.getModule(item.moduleId as ModuleId)
      checks.push(
        check(
          `module.${item.moduleId}.current`,
          Boolean(
            module &&
            module.currentVersionId === item.moduleVersionId &&
            module.status === 'INTEGRATED',
          ),
          module
            ? `current=${module.currentVersionId ?? 'none'}; status=${module.status}`
            : 'Module missing',
        ),
      )
      checks.push(
        check(
          `module.${item.moduleId}.commit`,
          Boolean(commitAvailable && tree === item.treeHash),
          commitAvailable
            ? `Commit ${item.commitSha} tree ${tree}`
            : `Commit ${item.commitSha} is not available`,
        ),
      )
    }
    return checks
  }

  private verifyReviews(
    manifest: IntegrationManifest,
    reviews: readonly Review[],
  ): FeedbackGateCheck {
    const missing: string[] = []
    const rejected: string[] = []
    for (const module of manifest.modules) {
      const moduleReviews = reviews.filter(
        (review) => review.moduleVersionId === module.moduleVersionId,
      )
      for (const role of REVIEW_ROLES) {
        const review = moduleReviews.find((candidate) => candidate.judgeRole === role)
        if (!review || review.evidence.length === 0) missing.push(`${module.moduleName}:${role}`)
        else if (review.verdict !== 'APPROVE') rejected.push(`${module.moduleName}:${role}`)
      }
    }
    return check(
      'jury.approvals',
      missing.length === 0 && rejected.length === 0,
      missing.length > 0 || rejected.length > 0
        ? `Missing=${missing.join(',') || 'none'}; rejected=${rejected.join(',') || 'none'}`
        : 'All four judge reviews are present, evidencing and approving',
    )
  }

  private persistResult(input: {
    readonly principal: Principal
    readonly project: ProjectRef
    readonly plan: Plan
    readonly manifestRecord: IntegrationManifestRecord
    readonly manifest?: IntegrationManifest
    readonly feedback: FeedbackRunRecord
    readonly report: StoredFeedbackReport
    readonly verdict: 'PASS' | 'FAIL'
    readonly affectedModules: readonly string[]
    readonly reworkTaskIds: readonly string[]
  }): FeedbackResult {
    const hash = sha256({
      manifestHash: input.manifestRecord.hash,
      planHash: input.plan.hash,
      verdict: input.verdict,
      report: input.report,
    })
    return this.store.transaction(() => {
      const stored = this.store.updateFeedbackRun(input.feedback.id, {
        status: 'COMPLETED',
        verdict: input.verdict,
        report: input.report as unknown as Record<string, unknown>,
        hash,
      })
      if (input.verdict === 'PASS' && input.manifest) {
        const delivery = this.createDelivery(
          {
            project: input.project,
            plan: input.plan,
            manifestRecord: input.manifestRecord,
            manifest: input.manifest,
            report: input.report,
          },
          stored,
          input.manifest,
        )
        this.emit(
          input.project.id,
          'feedback.passed',
          'feedback_run',
          stored.id,
          input.principal.subjectId,
          {
            feedbackId: stored.id,
            manifestId: input.manifestRecord.id,
            deliveryId: delivery.id,
            hash,
          },
        )
        this.notifyParent(input, delivery, input.report)
        return {
          feedback: stored,
          delivery,
          reused: false,
          affectedModules: input.affectedModules,
          reworkTaskIds: [],
        }
      }

      const reworkTaskIds: string[] = []
      if (input.manifest) {
        reworkTaskIds.push(
          ...this.scheduleTargetedRework(
            input.principal,
            input.project,
            input.plan,
            input.manifest,
            input.report,
            input.affectedModules,
          ),
        )
      }
      const currentProject = this.store.getProject(input.project.id)!
      if (
        currentProject.status === 'FEEDBACK' &&
        canTransitionProject(currentProject.status, 'RUNNING')
      ) {
        this.store.updateProjectStatus(currentProject.id, 'RUNNING', currentProject.version)
      }
      this.notifyCoordinator(input, stored, reworkTaskIds)
      this.emit(
        input.project.id,
        'feedback.failed',
        'feedback_run',
        stored.id,
        input.principal.subjectId,
        {
          feedbackId: stored.id,
          manifestId: input.manifestRecord.id,
          affectedModules: input.affectedModules,
          reworkTaskIds,
          hash,
        },
      )
      return {
        feedback: stored,
        reused: false,
        affectedModules: input.affectedModules,
        reworkTaskIds,
      }
    })
  }

  private createDelivery(
    input: {
      readonly project: ProjectRef
      readonly plan: Plan
      readonly manifestRecord: IntegrationManifestRecord
      readonly manifest: IntegrationManifest
      readonly report: StoredFeedbackReport
    },
    feedback: FeedbackRunRecord,
    manifest: IntegrationManifest,
  ): FinalDeliveryRecord {
    const existing = this.store.getFinalDeliveryByManifest(input.manifestRecord.id)
    if (existing) return existing
    const summary = {
      kind: 'FinalDelivery',
      projectId: input.project.id,
      projectName: input.project.name,
      plan: { id: input.plan.id, title: input.plan.title, hash: input.plan.hash },
      manifest: {
        id: input.manifestRecord.id,
        hash: input.manifestRecord.hash,
        integrationCommit: manifest.integrationCommit,
        baseCommit: manifest.baseCommit,
      },
      modules: manifest.modules,
      adapters: manifest.adapters.map((adapter) => ({
        path: adapter.path,
        version: adapter.version,
        specHash: adapter.specHash,
        tests: adapter.tests.map((test) => ({
          command: test.command,
          passed: test.passed,
          exitCode: test.exitCode,
        })),
      })),
      criteria: input.report.criteria,
      integrationTests: manifest.integrationTests.map((test) => ({
        command: test.command,
        passed: test.passed,
        exitCode: test.exitCode,
      })),
      findings: input.report.findings,
      evidence: [
        `manifest:${input.manifestRecord.id}:${input.manifestRecord.hash}`,
        `feedback:${feedback.id}:${feedback.hash}`,
        ...input.report.checks
          .filter((item) => item.passed)
          .map((item) => `${item.code}: ${item.detail}`),
      ],
      howToVerify: [
        `git show ${manifest.integrationCommit}`,
        ...manifest.integrationTests.map((test) => test.command),
      ],
      deliveryStatus: 'READY',
      note: 'Entrega preparada. Requiere finalizacion humana explicita antes de considerarse entregada.',
    }
    const delivery = this.store.createFinalDelivery({
      projectId: input.project.id,
      manifestId: input.manifestRecord.id,
      feedbackId: feedback.id,
      summary,
    })
    if (this.signingSecret) {
      this.store.createArtifactSignature({
        projectId: input.project.id,
        subjectType: 'FINAL_DELIVERY',
        subjectId: delivery.id,
        subjectHash: sha256({
          manifestHash: input.manifestRecord.hash,
          feedbackHash: feedback.hash,
        }),
        signature: signArtifact(
          {
            subjectType: 'FINAL_DELIVERY',
            subjectId: delivery.id,
            projectId: input.project.id,
            manifestId: input.manifestRecord.id,
            manifestHash: input.manifestRecord.hash,
            feedbackId: feedback.id,
            feedbackHash: feedback.hash,
          },
          this.signingSecret,
        ),
      })
    }
    const parent = this.store.getAgentByOpenCodeId(input.project.id, 'padre')
    this.emit(input.project.id, 'delivery.ready', 'final_delivery', delivery.id, 'feedback', {
      deliveryId: delivery.id,
      manifestId: input.manifestRecord.id,
      feedbackId: feedback.id,
      parentAgentId: parent?.id ?? null,
    })
    return delivery
  }

  private notifyParent(
    input: {
      readonly project: ProjectRef
      readonly principal: Principal
      readonly manifestRecord: IntegrationManifestRecord
    },
    delivery: FinalDeliveryRecord,
    report: StoredFeedbackReport,
  ): void {
    const parent = this.store.getAgentByOpenCodeId(input.project.id, 'padre')
    const sender =
      (input.principal.agentId
        ? this.store.getAgent(input.principal.agentId as AgentId)
        : undefined) ?? this.store.getAgentByOpenCodeId(input.project.id, 'feedback')
    if (!parent || !sender) return
    this.store.createMessage({
      projectId: input.project.id,
      fromAgentId: sender.id,
      toAgentId: parent.id,
      correlationId: `delivery:${delivery.id}`,
      kind: 'INFO',
      priority: 100,
      payload: {
        kind: 'FinalDeliveryReady',
        deliveryId: delivery.id,
        manifestId: input.manifestRecord.id,
        manifestHash: input.manifestRecord.hash,
        feedbackVerdict: report.verdict,
        summary: report.summary,
        note: 'No declares finalizado el proyecto sin finalizar y entregar esta evidencia.',
      },
      requiresApproval: false,
      idempotencyKey: `delivery-ready:${input.manifestRecord.id}`,
    })
    this.emit(
      input.project.id,
      'delivery.parent_notified',
      'final_delivery',
      delivery.id,
      sender.id,
      {
        deliveryId: delivery.id,
        parentAgentId: parent.id,
      },
    )
  }

  private scheduleTargetedRework(
    principal: Principal,
    project: ProjectRef,
    plan: Plan,
    manifest: IntegrationManifest,
    report: StoredFeedbackReport,
    affectedModules: readonly string[],
  ): string[] {
    const tasks = this.store.listTasks(project.id)
    const created: string[] = []
    for (const moduleId of affectedModules) {
      const module = this.store.getModule(moduleId as ModuleId)
      if (!module) continue
      const manifestModule = manifest.modules.find((candidate) => candidate.moduleId === moduleId)
      if (!manifestModule) continue
      const alreadyOpen = tasks.some(
        (task) =>
          task.moduleId === module.id &&
          ['PENDING', 'READY', 'RUNNING', 'REWORK_REQUIRED'].includes(task.state),
      )
      if (alreadyOpen) continue
      const sourceContract = this.store.getContract(manifestModule.contractId as never)
      const sourceTask = sourceContract ? this.store.getTask(sourceContract.taskId) : undefined
      const ownerId = sourceTask?.ownerAgentId ?? module.ownerAgentId
      const nextCycle = (sourceTask?.reviewCycle ?? 0) + 1
      const reworkTask = this.store.createTask({
        projectId: project.id,
        planId: plan.id,
        moduleId: module.id,
        title: `Feedback rework ${module.name}`,
        description: feedbackDescription(module.name, report),
        state: 'PENDING',
        priority: sourceTask?.priority ?? 70,
        ownerAgentId: ownerId,
        maxAttempts: sourceTask?.maxAttempts ?? 3,
        reviewCycle: nextCycle,
      })
      if (sourceContract) {
        const contract = this.store.createContract({
          taskId: reworkTask.id,
          moduleId: module.id,
          version: 1,
          objective: sourceContract.objective,
          allowedPaths: sourceContract.allowedPaths,
          inputInterfaces: sourceContract.inputInterfaces,
          outputInterfaces: sourceContract.outputInterfaces,
          acceptanceTests: sourceContract.acceptanceTests,
          limits: sourceContract.limits,
          deliveryFormat: sourceContract.deliveryFormat,
          hash: sha256({
            sourceContract: sourceContract.hash,
            taskId: reworkTask.id,
            reason: 'feedback',
            cycle: nextCycle,
          }),
          status: 'ACTIVE',
        })
        this.store.setTaskContract(reworkTask.id, contract.id)
      }
      this.store.assignTask(reworkTask.id, ownerId as AgentId)
      this.emit(
        project.id,
        'feedback.rework_scheduled',
        'task',
        reworkTask.id,
        principal.subjectId,
        {
          taskId: reworkTask.id,
          moduleId: module.id,
          affectedModules,
        },
      )
      created.push(reworkTask.id)
    }
    return created
  }

  private notifyCoordinator(
    input: {
      readonly project: ProjectRef
      readonly principal: Principal
      readonly manifestRecord: IntegrationManifestRecord
    },
    feedback: FeedbackRunRecord,
    reworkTaskIds: readonly string[],
  ): void {
    const coordinator = this.store.getAgentByOpenCodeId(input.project.id, 'coordinador')
    const sender =
      (input.principal.agentId
        ? this.store.getAgent(input.principal.agentId as AgentId)
        : undefined) ?? this.store.getAgentByOpenCodeId(input.project.id, 'feedback')
    if (!coordinator || !sender) return
    this.store.createMessage({
      projectId: input.project.id,
      fromAgentId: sender.id,
      toAgentId: coordinator.id,
      correlationId: `feedback:${feedback.id}`,
      kind: 'INFO',
      priority: 90,
      payload: {
        kind: 'FeedbackDiagnosis',
        feedbackId: feedback.id,
        manifestId: input.manifestRecord.id,
        verdict: feedback.verdict,
        affectedModules: feedback.report['affectedModules'] ?? [],
        reworkTaskIds,
        findings: feedback.report['findings'] ?? [],
      },
      requiresApproval: false,
      idempotencyKey: `feedback-report:${input.manifestRecord.id}`,
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
    this.store.appendOutbox(event.id, 'orchestrator.feedback', {
      eventId: event.id,
      type: event.type,
      aggregateId: event.aggregateId,
    })
  }
}

export class DeliveryService {
  constructor(
    private readonly store: SqliteStore,
    private readonly authz: AuthorizationService,
  ) {}

  list(projectId: ProjectId): FinalDeliveryRecord[] {
    return this.store.listFinalDeliveries(projectId)
  }

  get(deliveryId: string): FinalDeliveryRecord {
    const delivery = this.store.getFinalDelivery(deliveryId)
    if (!delivery) throw new NotFoundError(`Final delivery ${deliveryId} not found`)
    return delivery
  }

  finalize(principal: Principal, deliveryId: string): FinalDeliveryRecord {
    const delivery = this.get(deliveryId)
    this.authz.require(principal, 'delivery.finalize', {
      type: 'project',
      id: delivery.projectId,
    })
    if (delivery.status === 'DELIVERED') return delivery
    const feedback = this.store.getFeedbackRun(delivery.feedbackId)
    if (
      !feedback ||
      feedback.verdict !== 'PASS' ||
      feedback.status !== 'COMPLETED' ||
      feedback.manifestId !== delivery.manifestId ||
      feedback.report['readyForFinalDelivery'] !== true
    ) {
      throw new ConflictError('Final delivery requires a completed PASS feedback with evidence')
    }
    if (!this.store.getIntegrationManifest(delivery.manifestId)) {
      throw new ConflictError('Final delivery manifest is missing')
    }
    const project = this.store.getProject(delivery.projectId)
    if (!project) throw new NotFoundError('Project not found')
    if (project.status !== 'FEEDBACK') {
      throw new ConflictError(`Project is ${project.status}; delivery is not pending`)
    }
    return this.store.transaction(() => {
      this.store.markFinalDeliveryDelivered(delivery.id)
      this.store.createApproval({
        projectId: project.id,
        subjectType: 'DELIVERY',
        subjectId: delivery.id,
        subjectHash: sha256(delivery.summary),
        approverId: principal.subjectId,
        decision: 'APPROVED',
        reason: 'Human final delivery approval',
      })
      if (canTransitionProject(project.status, 'COMPLETED')) {
        this.store.updateProjectStatus(project.id, 'COMPLETED', project.version)
      }
      this.emit(
        project.id,
        'delivery.finalized',
        'final_delivery',
        delivery.id,
        principal.subjectId,
        {
          deliveryId: delivery.id,
          manifestId: delivery.manifestId,
        },
      )
      return this.store.getFinalDelivery(delivery.id)!
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
    this.store.appendOutbox(event.id, 'orchestrator.delivery', {
      eventId: event.id,
      type: event.type,
      aggregateId: event.aggregateId,
    })
  }
}

interface ProjectRef {
  readonly id: ProjectId
  readonly name: string
  readonly status: string
  readonly version: number
}

function evaluateFeedbackReport(
  report: FeedbackReport,
  criteria: readonly IntegrationCriterion[],
  baseChecks: readonly FeedbackGateCheck[],
): {
  verdict: 'PASS' | 'FAIL'
  checks: FeedbackGateCheck[]
  findings: FeedbackFinding[]
} {
  const checks: FeedbackGateCheck[] = []
  const findings: FeedbackFinding[] = []
  const byId = new Map(report.criteria.map((criterion) => [criterion.id, criterion]))
  for (const criterion of criteria) {
    const result = byId.get(criterion.id)
    const required = criterion.required
    const hasEvidence = Boolean(result && result.evidence.length > 0)
    const passed = Boolean(result && result.status === 'PASS' && hasEvidence)
    if (required || result) {
      checks.push(
        check(
          `criterion.${criterion.id}`,
          passed || (!required && result?.status === 'FAIL'),
          result
            ? `${result.status}; evidence=${result.evidence.length}`
            : 'Criterion missing from feedback report',
        ),
      )
      if (required && !passed) {
        findings.push({
          id: `criterion-${criterion.id}`,
          severity: 'MAJOR',
          message: result
            ? `Criterion ${criterion.id} is ${result.status} or lacks evidence`
            : `Criterion ${criterion.id} is missing from the feedback report`,
          ...(criterion.moduleId ? { moduleId: criterion.moduleId } : {}),
          criterionId: criterion.id,
          requestedAction: 'Corregir el requisito y aportar evidencia reproducible.',
          evidence: result?.evidence ?? [],
        })
      }
    }
  }
  const blockingFinding = report.findings.some(
    (finding) => finding.severity === 'MAJOR' || finding.severity === 'CRITICAL',
  )
  checks.push(
    check('feedback.agent.verdict', report.verdict === 'PASS', `Agent verdict: ${report.verdict}`),
  )
  checks.push(
    check(
      'feedback.agent.ready',
      report.readyForFinalDelivery,
      `Agent readyForFinalDelivery: ${report.readyForFinalDelivery}`,
    ),
  )
  checks.push(
    check(
      'feedback.findings',
      !blockingFinding,
      blockingFinding ? 'Report contains MAJOR/CRITICAL findings' : 'No blocking findings',
    ),
  )
  checks.push(
    check(
      'feedback.criteria.evidence',
      criteria.every((criterion) => {
        const result = byId.get(criterion.id)
        return !criterion.required || (result?.status === 'PASS' && result.evidence.length > 0)
      }),
      'All required criteria need PASS with evidence',
    ),
  )
  if (!report.readyForFinalDelivery && report.verdict === 'PASS') {
    findings.push({
      id: 'feedback-not-ready',
      severity: 'MAJOR',
      message: 'El agente declaro PASS pero no readyForFinalDelivery',
      requestedAction: 'Completar la evidencia o corregir el veredicto.',
      evidence: [],
    })
  }
  const verdict =
    baseChecks.every((item) => item.passed) && checks.every((item) => item.passed) ? 'PASS' : 'FAIL'
  if (verdict === 'FAIL' && findings.length === 0) {
    findings.push({
      id: 'feedback-gate',
      severity: 'MAJOR',
      message: 'La puerta determinista de feedback no aprobo el producto',
      requestedAction: 'Revisar los checks fallidos y aportar evidencia.',
      evidence: checks.filter((item) => !item.passed).map((item) => `${item.code}: ${item.detail}`),
    })
  }
  return { verdict, checks, findings }
}

function collectAffectedModules(report: FeedbackReport, manifest: IntegrationManifest): string[] {
  const selected = new Set(manifest.modules.map((module) => module.moduleId))
  const affected = new Set<string>()
  for (const criterion of report.criteria) {
    if (criterion.status !== 'FAIL') continue
    const definition = manifest.criteria.find((item) => item.id === criterion.id)
    if (definition?.moduleId && selected.has(definition.moduleId)) affected.add(definition.moduleId)
  }
  for (const finding of report.findings) {
    if (
      (finding.severity === 'MAJOR' || finding.severity === 'CRITICAL') &&
      finding.moduleId &&
      selected.has(finding.moduleId)
    ) {
      affected.add(finding.moduleId)
    }
  }
  return [...affected].sort()
}

function feedbackDescription(moduleName: string, report: StoredFeedbackReport): string {
  const failed = report.criteria.filter((criterion) => criterion.status === 'FAIL')
  const findings = report.findings.filter(
    (finding) => finding.severity === 'MAJOR' || finding.severity === 'CRITICAL',
  )
  return [
    `Corrige solo el modulo ${moduleName} segun el feedback global.`,
    '',
    'Criterios incumplidos:',
    failed.length > 0
      ? failed.map((criterion) => `- ${criterion.id}: ${criterion.notes ?? 'FAIL'}`).join('\n')
      : '- Sin criterio concreto; revisar diagnostico.',
    '',
    'Hallazgos:',
    findings.length > 0
      ? findings.map((finding) => `- [${finding.severity}] ${finding.message}`).join('\n')
      : '- Sin hallazgos bloqueantes.',
    '',
    'No modifiques otros modulos. El orquestador creara una nueva version y revalidara lo modificado.',
  ].join('\n')
}

function check(code: string, passed: boolean, detail: string): FeedbackGateCheck {
  return { code, passed, detail: redactText(detail) }
}

export const __testing = {
  evaluateFeedbackReport,
  collectAffectedModules,
}

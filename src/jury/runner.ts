import type { AppConfig } from '../config/env.js'
import { parseModelRef } from '../config/env.js'
import type { Agent, Contract, ModuleVersion, Task } from '../domain/index.js'
import type { ProjectId, TaskId } from '../domain/ids.js'
import type { AuthorizationService } from '../auth/authorization.js'
import type { Principal } from '../auth/types.js'
import type { JudgeReport } from './verdict.js'
import { JudgeReportSchema, JuryVerdictService, MANDATORY_ROLES, REVIEW_ROLES } from './verdict.js'
import type { ConsolidationRecord, JuryRunRecord, SqliteStore } from '../persistence/store.js'
import type { SessionManager } from '../sessions/manager.js'
import type { WorktreeManager, TestCommandResult } from '../worktrees/manager.js'
import { JuryDecisionService, type JuryDecisionResult } from './decision.js'
import { redactText } from '../security/redaction.js'
import { sha256 } from '../security/hash.js'

const ROLE_TO_AGENT: Record<(typeof REVIEW_ROLES)[number], string> = {
  JUDGE_TESTS: 'testing',
  JUDGE_DEBUG: 'debugger',
  JUDGE_ARCHITECTURE: 'architecture',
  JUDGE_OPTIMIZATION: 'optimizer',
}

export interface JudgeExecutionInput {
  readonly projectId: ProjectId
  readonly task: Task
  readonly contract: Contract
  readonly moduleVersion: ModuleVersion
  readonly snapshotPath: string
  readonly testEvidence: TestEvidence
}

export interface TestEvidence {
  readonly passed: boolean
  readonly commands: readonly TestCommandResult[]
  readonly error?: string
}

export interface JudgeExecutionResult {
  readonly report: JudgeReport
  readonly sessionId?: string
}

export interface JudgeExecutor {
  run(
    input: JudgeExecutionInput,
    role: (typeof REVIEW_ROLES)[number],
  ): Promise<JudgeExecutionResult>
}

export class OpenCodeJudgeExecutor implements JudgeExecutor {
  constructor(
    private readonly store: SqliteStore,
    private readonly sessions: SessionManager,
    private readonly config: AppConfig,
  ) {}

  async run(
    input: JudgeExecutionInput,
    role: (typeof REVIEW_ROLES)[number],
  ): Promise<JudgeExecutionResult> {
    const agent = this.store.getAgentByOpenCodeId(input.projectId, ROLE_TO_AGENT[role])
    if (!agent) throw new Error(`Judge agent ${ROLE_TO_AGENT[role]} not found`)
    const session = await this.sessions.createReadOnlySession({
      projectId: input.projectId,
      agent,
      directory: input.snapshotPath,
      title: `Jury ${role} - ${input.moduleVersion.id}`,
      metadata: {
        role,
        moduleVersionId: input.moduleVersion.id,
        taskId: input.task.id,
      },
      ...(parseModelRef(this.config.ORCH_AGENT_MODEL ?? this.config.OPENCODE_MODEL)
        ? { model: parseModelRef(this.config.ORCH_AGENT_MODEL ?? this.config.OPENCODE_MODEL)! }
        : {}),
    })
    try {
      await this.sessions.prompt(session.record, this.prompt(input, role, agent))
      const transcript = await this.sessions.wait(session.record, this.config.ORCH_JURY_TIMEOUT_MS)
      const text =
        [...transcript].reverse().find((message) => message.role === 'assistant')?.text ?? ''
      return { report: this.parseReport(text, input, role), sessionId: session.record.id }
    } catch (error) {
      throw new Error(
        `Judge ${role} failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }

  private prompt(
    input: JudgeExecutionInput,
    role: (typeof REVIEW_ROLES)[number],
    agent: Agent,
  ): string {
    const tests = input.testEvidence.commands
      .map(
        (command) =>
          `- ${command.command}: ${command.passed ? 'PASS' : 'FAIL'} (exit ${command.exitCode})\nSTDOUT: ${redactText(command.stdout).slice(0, 4000)}\nSTDERR: ${redactText(command.stderr).slice(0, 4000)}`,
      )
      .join('\n')
    return [
      `Eres ${agent.name} (${role}) en un jurado independiente.`,
      'Acceso de solo lectura. No modifiques archivos, no ejecutes shell y no uses subagentes.',
      `Snapshot: ${input.snapshotPath}`,
      `Versión inmutable: ${input.moduleVersion.id}`,
      `Commit: ${input.moduleVersion.commitSha}`,
      `Tarea: ${input.task.title}`,
      '',
      'Contrato:',
      JSON.stringify(input.contract, null, 2),
      '',
      'Evidencia de tests ejecutada por el orquestador:',
      `passed=${input.testEvidence.passed}`,
      tests || '(sin comandos de test)',
      input.testEvidence.error ? `error=${input.testEvidence.error}` : '',
      '',
      roleInstructions(role),
      '',
      'Devuelve EXCLUSIVAMENTE un objeto JSON válido, sin Markdown, con esta forma:',
      JSON.stringify(
        {
          judgeRole: role,
          moduleVersionId: input.moduleVersion.id,
          commitSha: input.moduleVersion.commitSha,
          verdict: 'APPROVE|REJECT',
          findings: [
            {
              id: 'string',
              severity: 'INFO|MINOR|MAJOR|CRITICAL',
              category:
                'tests|debug|architecture|performance|memory|resource|security|data-loss|concurrency|contract|acceptance|maintainability|other',
              message: 'string',
              criterion: 'string',
              evidence: ['string'],
            },
          ],
          evidence: ['string'],
          summary: 'string',
        },
        null,
        2,
      ),
      '',
      'Un APPROVE sin evidencia no se aceptará. Un CRITICAL de optimización debe ser reproducible, tener evidencia y estar ligado a un criterio o límite.',
    ]
      .filter(Boolean)
      .join('\n')
  }

  private parseReport(
    text: string,
    input: JudgeExecutionInput,
    role: (typeof REVIEW_ROLES)[number],
  ): JudgeReport {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('Judge response did not contain JSON')
    let parsed: unknown
    try {
      parsed = JSON.parse(text.slice(start, end + 1))
    } catch (error) {
      throw new Error(
        `Judge response JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
    const report = JudgeReportSchema.parse(parsed)
    if (report.judgeRole !== role) throw new Error('Judge returned a report for another role')
    if (report.moduleVersionId !== input.moduleVersion.id) {
      throw new Error('Judge returned a report for another module version')
    }
    if (report.commitSha.toLowerCase() !== input.moduleVersion.commitSha.toLowerCase()) {
      throw new Error('Judge returned a report for another commit')
    }
    return report
  }
}

export class JuryService {
  private readonly verdicts = new JuryVerdictService()
  private readonly decisions: JuryDecisionService

  constructor(
    private readonly store: SqliteStore,
    private readonly authz: AuthorizationService,
    private readonly worktrees: WorktreeManager,
    private readonly executor: JudgeExecutor,
    private readonly config: AppConfig,
  ) {
    this.decisions = new JuryDecisionService(store, {
      maxReworkCycles: config.ORCH_MAX_REWORK_CYCLES,
    })
  }

  async run(
    principal: Principal,
    taskId: TaskId,
  ): Promise<{
    run: JuryRunRecord
    reviews: ReturnType<SqliteStore['listReviewsForVersion']>
    consolidation: ConsolidationRecord
    decision: JuryDecisionResult
  }> {
    const task = this.store.getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    this.authz.require(principal, 'jury.run', { type: 'project', id: task.projectId })
    if (task.state !== 'IN_REVIEW')
      throw new Error(`Task ${taskId} is ${task.state}, not IN_REVIEW`)
    const moduleVersion = this.resolveVersion(task)
    if (!moduleVersion) throw new Error(`Task ${taskId} has no module version`)
    const module = this.store.getModule(moduleVersion.moduleId)
    if (!module) throw new Error(`Module ${moduleVersion.moduleId} not found`)
    const contract = this.resolveContract(task)
    if (!contract) throw new Error(`Task ${taskId} has no active contract`)

    const existingConsolidation = this.store.getConsolidationByVersion(moduleVersion.id)
    if (existingConsolidation) {
      const reviews = this.store.listReviewsForVersion(moduleVersion.id)
      return {
        run: this.store.getJuryRunByVersion(moduleVersion.id)!,
        reviews,
        consolidation: existingConsolidation,
        decision: {
          verdict: existingConsolidation.verdict,
          blocked: existingConsolidation.verdict !== 'APPROVED',
        },
      }
    }

    const existingRun = this.store.getJuryRunByVersion(moduleVersion.id)
    const run =
      existingRun ??
      this.store.createJuryRun({
        projectId: task.projectId,
        taskId: task.id,
        moduleVersionId: moduleVersion.id,
        cycle: task.reviewCycle,
      })
    if (!existingRun) {
      this.emit(task.projectId, 'jury.run.started', run.id, {
        moduleVersionId: moduleVersion.id,
        commitSha: moduleVersion.commitSha,
        cycle: task.reviewCycle,
      })
    }

    const testSnapshot = this.worktrees.createDetached(
      `jury-tests-${moduleVersion.id}`,
      moduleVersion.commitSha,
    )
    const testEvidence = this.runContractTests(testSnapshot.path, contract)
    const judgeSnapshot = this.worktrees.createDetached(
      `jury-${moduleVersion.id}`,
      moduleVersion.commitSha,
    )

    const existingReviews = this.store.listReviewsForVersion(moduleVersion.id)
    const existingRoles = new Set(existingReviews.map((review) => review.judgeRole))
    const missingRoles = REVIEW_ROLES.filter((role) => !existingRoles.has(role))
    const execution = await Promise.all(
      missingRoles.map(async (role) => {
        try {
          return await this.executor.run(
            {
              projectId: task.projectId,
              task,
              contract,
              moduleVersion,
              snapshotPath: judgeSnapshot.path,
              testEvidence,
            },
            role,
          )
        } catch (error) {
          return {
            report: unavailableReport(role, moduleVersion, error),
            sessionId: undefined,
          } satisfies JudgeExecutionResult
        }
      }),
    )

    this.store.transaction(() => {
      for (const result of execution) {
        let report = result.report
        if (report.judgeRole === 'JUDGE_TESTS') {
          report = enforceTestsGate(report, testEvidence)
        }
        const existing = this.store
          .listReviewsForVersion(moduleVersion.id)
          .find((review) => review.judgeRole === report.judgeRole)
        if (existing) continue
        this.store.createReview({
          projectId: task.projectId,
          moduleVersionId: moduleVersion.id,
          judgeRole: report.judgeRole,
          verdict: report.verdict,
          findings: report.findings,
          evidence: report.evidence,
          hash: sha256(report),
        })
      }
    })

    const reviews = this.store.listReviewsForVersion(moduleVersion.id)
    const consolidation = this.verdicts.consolidate(reviews, {
      moduleVersionId: moduleVersion.id,
      commitSha: moduleVersion.commitSha,
    })
    const storedConsolidation = this.store.transaction(() => {
      const existing = this.store.getConsolidationByVersion(moduleVersion.id)
      if (existing) return existing
      const stored = this.store.createConsolidation({
        juryRunId: run.id,
        moduleVersionId: moduleVersion.id,
        verdict: consolidation.verdict,
        blocking: [...consolidation.blocking],
        recommendations: [...consolidation.recommendations],
        missingRoles: [...consolidation.missingRoles],
        hash: consolidation.hash,
      })
      this.store.updateJuryRunStatus(run.id, 'COMPLETED')
      this.emit(task.projectId, 'jury.consolidated', run.id, {
        moduleVersionId: moduleVersion.id,
        verdict: consolidation.verdict,
        hash: consolidation.hash,
        blocking: consolidation.blocking.length,
      })
      return stored
    })

    const decision = this.decisions.apply({
      projectId: task.projectId,
      taskId: task.id,
      moduleVersionId: moduleVersion.id,
      juryRunId: run.id,
      consolidation,
    })

    return {
      run: this.store.getJuryRun(run.id)!,
      reviews,
      consolidation: storedConsolidation,
      decision,
    }
  }

  private resolveVersion(task: Task): ModuleVersion | undefined {
    if (!task.moduleId) return undefined
    const module = this.store.getModule(task.moduleId)
    if (!module) return undefined
    if (module.currentVersionId) return this.store.getModuleVersion(module.currentVersionId)
    return this.store.listModuleVersions(module.id)[0]
  }

  private resolveContract(task: Task): Contract | undefined {
    if (task.contractId) {
      const contract = this.store.getContract(task.contractId)
      if (contract?.status === 'ACTIVE') return contract
    }
    return this.store
      .listContracts(task.projectId)
      .find((contract) => contract.taskId === task.id && contract.status === 'ACTIVE')
  }

  private emit(
    projectId: ProjectId,
    type: string,
    aggregateId: string,
    payload: Record<string, unknown>,
  ): void {
    const event = this.store.appendEvent({
      projectId,
      type,
      aggregateType: 'jury_run',
      aggregateId,
      actorId: 'jury',
      payload,
    })
    this.store.appendOutbox(event.id, 'orchestrator.jury', {
      eventId: event.id,
      type: event.type,
      aggregateId: event.aggregateId,
    })
  }

  private runContractTests(snapshotPath: string, contract: Contract): TestEvidence {
    if (contract.acceptanceTests.length === 0) {
      return { passed: false, commands: [], error: 'Contract has no test commands' }
    }
    try {
      const commands = this.worktrees.runTests(
        snapshotPath,
        contract.acceptanceTests,
        this.config.ORCH_JURY_TIMEOUT_MS,
      )
      return {
        passed:
          commands.length === contract.acceptanceTests.length &&
          commands.every((command) => command.passed),
        commands,
      }
    } catch (error) {
      return {
        passed: false,
        commands: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

function roleInstructions(role: (typeof REVIEW_ROLES)[number]): string {
  switch (role) {
    case 'JUDGE_TESTS':
      return [
        'Evalúa pruebas unitarias/funcionales, casos límite y criterios de aceptación.',
        'Si la evidencia de tests tiene passed=false, tu veredicto DEBE ser REJECT.',
        'No apruebes sin evidencia de ejecución real.',
      ].join('\n')
    case 'JUDGE_DEBUG':
      return [
        'Busca bugs, errores lógicos, excepciones mal manejadas y problemas de concurrencia.',
        'Solo escala a MAJOR/CRITICAL con evidencia reproducible.',
      ].join('\n')
    case 'JUDGE_ARCHITECTURE':
      return [
        'Verifica contrato, interfaces, dependencias permitidas, límites de módulo y diseño.',
        'No evalúes estilo subjetivo como bloqueante.',
      ].join('\n')
    case 'JUDGE_OPTIMIZATION':
      return [
        'Evalúa rendimiento, memoria, recursos, complejidad y escalabilidad.',
        'Solo CRITICAL bloquea. Un CRITICAL debe ser demostrable, tener evidencia y estar ligado a un criterio o límite.',
        'MINOR/MAJOR se documentan como recomendaciones y no bloquean.',
      ].join('\n')
  }
}

function enforceTestsGate(report: JudgeReport, evidence: TestEvidence): JudgeReport {
  const evidenceStrings = [
    ...report.evidence,
    `orchestrator_tests_passed=${evidence.passed}`,
    ...evidence.commands.map(
      (command) => `${command.command} exit=${command.exitCode} passed=${command.passed}`,
    ),
  ]
  if (evidence.passed) return { ...report, evidence: evidenceStrings }
  return {
    ...report,
    verdict: 'REJECT',
    evidence: evidenceStrings,
    findings: [
      ...report.findings,
      {
        id: 'orchestrator-tests-failed',
        severity: 'MAJOR',
        category: 'tests',
        message: 'Los tests obligatorios del contrato fallaron o no pudieron ejecutarse',
        criterion: 'contract.acceptanceTests',
        evidence: evidenceStrings,
      },
    ],
    summary: 'Rechazado por evidencia determinista de tests del contrato.',
  }
}

function unavailableReport(
  role: (typeof REVIEW_ROLES)[number],
  moduleVersion: ModuleVersion,
  error: unknown,
): JudgeReport {
  return {
    judgeRole: role,
    moduleVersionId: moduleVersion.id,
    commitSha: moduleVersion.commitSha,
    verdict: 'REJECT',
    findings: [
      {
        id: `judge-unavailable-${role}`,
        severity: 'MAJOR',
        category: 'other',
        message: `El juez no emitió un informe válido: ${error instanceof Error ? error.message : String(error)}`,
        criterion: 'jury.independent-report',
        evidence: [],
      },
    ],
    evidence: [],
    summary: 'Juez no disponible o informe inválido; no se interpreta como aprobación.',
  }
}

export { MANDATORY_ROLES }

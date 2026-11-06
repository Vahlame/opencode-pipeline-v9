import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REVIEW_ROLES } from '../../src/jury/verdict.js'
import type { TestCommandResult } from '../../src/worktrees/manager.js'
import { WorktreeManager } from '../../src/worktrees/manager.js'
import { sha256 } from '../../src/security/hash.js'
import type {
  Contract,
  Module,
  ModuleVersion,
  Plan,
  Project,
  Task,
} from '../../src/domain/index.js'
import { createCoreFixture, type CoreFixture } from './phase2.js'

export interface Phase5Module {
  readonly name: string
  readonly root: string
  readonly module: Module
  readonly task: Task
  readonly contract: Contract
  readonly version: ModuleVersion
  readonly commitSha: string
  readonly treeHash: string
  readonly artifactHash: string
  readonly approved: boolean
}

export interface Phase5Fixture {
  readonly core: CoreFixture
  readonly root: string
  readonly repoRoot: string
  readonly worktreeRoot: string
  readonly worktrees: WorktreeManager
  readonly plan: Plan
  readonly project: Project
  readonly modules: ReadonlyMap<string, Phase5Module>
  readonly baseCommit: string
  close(): void
}

export interface CreateModuleOptions {
  readonly name: string
  readonly ownerCode: 'frontend' | 'backend' | 'database'
  readonly source: string
  readonly test: string
  readonly inputInterfaces: readonly string[]
  readonly outputInterfaces?: readonly string[]
  readonly approved: boolean
}

const MODULE_NAMES = ['frontend', 'backend', 'database'] as const

export function createPhase5Fixture(): Phase5Fixture {
  const root = mkdtempSync(join(tmpdir(), 'orch-phase5-'))
  const repoRoot = join(root, 'repo')
  mkdirSync(repoRoot, { recursive: true })
  git(repoRoot, ['init'])
  git(repoRoot, ['config', 'user.name', 'Phase 5 Test'])
  git(repoRoot, ['config', 'user.email', 'phase5@example.com'])
  writeFileSync(join(repoRoot, 'README.md'), '# phase 5 fixture\n')
  writeFileSync(join(repoRoot, '.gitignore'), '.worktrees/\n')
  git(repoRoot, ['add', '.'])
  git(repoRoot, ['commit', '-m', 'base'])
  const baseCommit = git(repoRoot, ['rev-parse', 'HEAD'])

  const core = createCoreFixture(repoRoot)
  const plan = core.approveAndStart('Phase 5 integration plan')
  const project = core.store.getProject(core.project.id)!
  const worktreeRoot = join(repoRoot, '.worktrees')
  const worktrees = new WorktreeManager(repoRoot, worktreeRoot)
  const modules = new Map<string, Phase5Module>()

  const definitions: CreateModuleOptions[] = [
    {
      name: 'frontend',
      ownerCode: 'frontend',
      source:
        "export function add(a, b) {\n  if (typeof a !== 'number' || typeof b !== 'number') throw new TypeError('numbers required')\n  return a + b\n}\nexport default add\n",
      test: "import assert from 'node:assert/strict'\nimport { add } from './demo.mjs'\nassert.equal(add(2, 3), 5)\nconsole.log('frontend ok')\n",
      inputInterfaces: ['add'],
      outputInterfaces: ['number'],
      approved: true,
    },
    {
      name: 'backend',
      ownerCode: 'backend',
      source:
        "export function multiply(a, b) {\n  if (typeof a !== 'number' || typeof b !== 'number') throw new TypeError('numbers required')\n  return a * b\n}\nexport default multiply\n",
      test: "import assert from 'node:assert/strict'\nimport { multiply } from './demo.mjs'\nassert.equal(multiply(3, 4), 12)\nconsole.log('backend ok')\n",
      inputInterfaces: ['multiply'],
      outputInterfaces: ['number'],
      approved: true,
    },
    {
      name: 'database',
      ownerCode: 'database',
      source: 'export function connect() {\n  return { ok: true }\n}\n',
      test: "import assert from 'node:assert/strict'\nimport { connect } from './demo.mjs'\nassert.equal(connect().ok, true)\nconsole.log('database ok')\n",
      inputInterfaces: ['connect'],
      outputInterfaces: ['object'],
      approved: false,
    },
  ]

  for (const definition of definitions) {
    const moduleFixture = createModule(core, plan, worktrees, definition)
    modules.set(definition.name, moduleFixture)
  }

  return {
    core,
    root,
    repoRoot,
    worktreeRoot,
    worktrees,
    plan,
    project,
    modules,
    baseCommit,
    close: () => {
      core.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

function createModule(
  core: CoreFixture,
  plan: Plan,
  worktrees: WorktreeManager,
  options: CreateModuleOptions,
): Phase5Module {
  const coordinator = core.principalFor('coordinador')
  const root = `modules/${options.name}`
  const module = core.service.createModule(coordinator, {
    projectId: core.project.id,
    name: options.name,
    ownerAgentId: core.agentByCode.get(options.ownerCode)!.id,
    pathScope: [`${root}/**`],
  })
  const task = core.service.createTask(coordinator, {
    projectId: core.project.id,
    planId: plan.id,
    moduleId: module.id,
    title: `Build ${options.name}`,
    description: `Build ${options.name} module`,
    ownerAgentId: core.agentByCode.get(options.ownerCode)!.id,
  })
  const contract = core.service.createContract(coordinator, {
    taskId: task.id,
    moduleId: module.id,
    objective: `Implement ${options.name}`,
    allowedPaths: [`${root}/**`],
    inputInterfaces: [...options.inputInterfaces],
    outputInterfaces: [...(options.outputInterfaces ?? ['number'])],
    acceptanceTests: [`node ${root}/demo.test.mjs`],
    limits: { maxDurationMinutes: 10 },
    deliveryFormat: 'DeliveryDraft',
  })
  const worktree = worktrees.create(task.id)
  mkdirSync(join(worktree.path, root), { recursive: true })
  writeFileSync(join(worktree.path, root, 'demo.mjs'), options.source)
  writeFileSync(join(worktree.path, root, 'demo.test.mjs'), options.test)
  const tests = worktrees.runTests(worktree.path, [`node ${root}/demo.test.mjs`], 10_000)
  assertTests(tests)
  const commit = worktrees.commit(worktree.path, [`${root}/**`], `approved ${options.name}`)
  const version = core.service.createModuleVersion(core.principalFor(options.ownerCode), {
    moduleId: module.id,
    commitSha: commit.commitSha,
    treeHash: commit.treeHash,
    artifactHash: commit.artifactHash,
  })
  core.store.updateTaskState(task.id, 'IN_REVIEW')
  if (options.approved) {
    approveModule(core, module, task, contract, version)
  }
  return {
    name: options.name,
    root,
    module: core.store.getModule(module.id)!,
    task: core.store.getTask(task.id)!,
    contract: core.store.getContract(contract.id)!,
    version: core.store.getModuleVersion(version.id)!,
    commitSha: commit.commitSha,
    treeHash: commit.treeHash,
    artifactHash: commit.artifactHash,
    approved: options.approved,
  }
}

function approveModule(
  core: CoreFixture,
  module: Module,
  task: Task,
  contract: Contract,
  version: ModuleVersion,
): void {
  const juryRun = core.store.createJuryRun({
    projectId: core.project.id,
    taskId: task.id,
    moduleVersionId: version.id,
    cycle: 0,
  })
  for (const role of REVIEW_ROLES) {
    core.store.createReview({
      projectId: core.project.id,
      moduleVersionId: version.id,
      judgeRole: role,
      verdict: 'APPROVE',
      findings: [],
      evidence: [`${role} evidence for ${version.id}`],
      hash: sha256({ role, version: version.id, evidence: 'fixture' }),
    })
  }
  core.store.updateJuryRunStatus(juryRun.id, 'COMPLETED')
  core.store.createConsolidation({
    juryRunId: juryRun.id,
    moduleVersionId: version.id,
    verdict: 'APPROVED',
    blocking: [],
    recommendations: [],
    missingRoles: [],
    hash: sha256({ version: version.id, verdict: 'APPROVED' }),
  })
  core.store.updateTaskState(task.id, 'APPROVED')
  core.store.updateModuleStatus(module.id, 'APPROVED')
  core.store.updateModuleVersionStatus(version.id, 'APPROVED')
  core.store.createApprovedModule({
    projectId: core.project.id,
    moduleId: module.id,
    moduleVersionId: version.id,
    commitSha: version.commitSha,
    artifactHash: version.artifactHash,
    juryRunId: juryRun.id,
  })
  core.store.setTaskContract(task.id, contract.id)
}

export function addNewUnapprovedVersion(fixture: Phase5Fixture, moduleName: string): ModuleVersion {
  const module = fixture.modules.get(moduleName)!
  const worktree = fixture.worktrees.create(`${module.task.id}_v2`)
  const path = module.root
  mkdirSync(join(worktree.path, path), { recursive: true })
  writeFileSync(
    join(worktree.path, path, 'demo.mjs'),
    'export function add(a, b) { return a + b }\nexport default add\n',
  )
  writeFileSync(
    join(worktree.path, path, 'demo.test.mjs'),
    "import assert from 'node:assert/strict'\nexport {}\nassert.equal(1, 1)\n",
  )
  const commit = fixture.worktrees.commit(worktree.path, [`${path}/**`], 'modified version')
  return fixture.core.service.createModuleVersion(fixture.core.principalFor('frontend'), {
    moduleId: module.module.id,
    commitSha: commit.commitSha,
    treeHash: commit.treeHash,
    artifactHash: commit.artifactHash,
  })
}

export function integrationTestFiles(): Record<string, string> {
  return {
    'integration/tests/e2e.mjs': [
      "import assert from 'node:assert/strict'",
      "import { sum } from '../adapters/frontend-sum.mjs'",
      "import { multiply } from '../../modules/backend/demo.mjs'",
      'assert.equal(sum(2, 3), 5)',
      'assert.equal(multiply(3, 4), 12)',
      "console.log('integration e2e ok')",
      '',
    ].join('\n'),
  }
}

export function frontendSumAdapter(): {
  moduleId: string
  path: string
  version: number
  reason: string
  files: Record<string, string>
  tests: string[]
} {
  return {
    moduleId: '',
    path: 'integration/adapters/frontend-sum.mjs',
    version: 1,
    reason: 'The approved frontend exposes add but the integration interface requires sum',
    files: {
      'integration/adapters/frontend-sum.mjs': [
        "import { add } from '../../modules/frontend/demo.mjs'",
        'export function sum(a, b) {',
        '  return add(a, b)',
        '}',
        'export default sum',
        '',
      ].join('\n'),
      'integration/adapters/frontend-sum.test.mjs': [
        "import assert from 'node:assert/strict'",
        "import { sum } from './frontend-sum.mjs'",
        'assert.equal(sum(4, 6), 10)',
        "console.log('adapter ok')",
        '',
      ].join('\n'),
    },
    tests: ['node integration/adapters/frontend-sum.test.mjs'],
  }
}

export function approvedIntegrationRequest(
  fixture: Phase5Fixture,
  options: {
    readonly modules?: readonly string[]
    readonly requiredModules?: readonly string[]
    readonly interfaceMappings?: boolean
    readonly adapter?: boolean
    readonly adapters?: readonly unknown[]
    readonly integrationTests?: readonly string[]
    readonly testFiles?: Record<string, string>
    readonly criteria?: readonly Record<string, unknown>[]
    readonly baseRef?: string
  } = {},
): Record<string, unknown> {
  const selected = options.modules ?? ['frontend', 'backend']
  const modules = selected.map((name) => {
    const module = fixture.modules.get(name)!
    return { moduleId: module.module.id, moduleVersionId: module.version.id }
  })
  const adapter = frontendSumAdapter()
  adapter.moduleId = fixture.modules.get('frontend')!.module.id
  return {
    projectId: fixture.project.id,
    planId: fixture.plan.id,
    modules,
    requiredModules: options.requiredModules ?? selected,
    integrationTests: options.integrationTests ?? [
      'node integration/tests/e2e.mjs',
      'node modules/frontend/demo.test.mjs',
      'node modules/backend/demo.test.mjs',
    ],
    testFiles: options.testFiles ?? integrationTestFiles(),
    interfaceMappings: options.interfaceMappings
      ? [
          {
            moduleId: fixture.modules.get('frontend')!.module.id,
            expected: 'sum',
            provided: 'add',
          },
        ]
      : [],
    adapters: options.adapters ?? (options.adapter ? [adapter] : []),
    criteria: options.criteria ?? [
      {
        id: 'AC-FRONTEND-SUM',
        description: 'Frontend exposes sum and adds correctly',
        required: true,
        moduleId: fixture.modules.get('frontend')!.module.id,
      },
      {
        id: 'AC-BACKEND-MULTIPLY',
        description: 'Backend multiplier works',
        required: true,
        moduleId: fixture.modules.get('backend')!.module.id,
      },
    ],
    ...(options.baseRef ? { baseRef: options.baseRef } : {}),
  }
}

export function passingFeedbackReport(_fixture: Phase5Fixture): Record<string, unknown> {
  return {
    verdict: 'PASS',
    criteria: [
      {
        id: 'AC-FRONTEND-SUM',
        status: 'PASS',
        evidence: ['integration/tests/e2e.mjs asserts sum(2,3)=5', 'adapter test passed'],
      },
      {
        id: 'AC-BACKEND-MULTIPLY',
        status: 'PASS',
        evidence: ['integration/tests/e2e.mjs asserts multiply(3,4)=12'],
      },
    ],
    findings: [],
    summary: 'Todos los criterios obligatorios tienen evidencia y pasan.',
    readyForFinalDelivery: true,
  }
}

export function failingFeedbackReport(fixture: Phase5Fixture): Record<string, unknown> {
  return {
    verdict: 'FAIL',
    criteria: [
      {
        id: 'AC-FRONTEND-SUM',
        status: 'FAIL',
        evidence: ['integration/tests/e2e.mjs observed an incorrect sum'],
        notes: 'El adaptador no esta alineado con el requisito.',
      },
      {
        id: 'AC-BACKEND-MULTIPLY',
        status: 'PASS',
        evidence: ['integration/tests/e2e.mjs asserts multiply(3,4)=12'],
      },
    ],
    findings: [
      {
        id: 'FB-1',
        severity: 'MAJOR',
        message: 'El modulo frontend no cumple sum',
        moduleId: fixture.modules.get('frontend')!.module.id,
        criterionId: 'AC-FRONTEND-SUM',
        requestedAction: 'Corregir solo frontend y revalidar.',
        evidence: ['integration/tests/e2e.mjs'],
      },
    ],
    summary: 'El modulo frontend incumple un criterio obligatorio.',
    readyForFinalDelivery: false,
  }
}

export function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

function assertTests(results: readonly TestCommandResult[]): void {
  if (results.length === 0 || results.some((result) => !result.passed)) {
    throw new Error(`Fixture tests failed: ${JSON.stringify(results)}`)
  }
}

export const MODULE_NAMES_LIST = MODULE_NAMES

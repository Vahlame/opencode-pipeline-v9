import { sha256 } from '../security/hash.js'
import type {
  IntegrationAdapterSpec,
  IntegrationCriterion,
  IntegrationManifest,
  IntegrationManifestAdapter,
  IntegrationManifestConflict,
  IntegrationManifestModule,
  InterfaceMapping,
} from './contracts.js'

export interface ResolvedModuleSnapshot {
  readonly moduleId: string
  readonly moduleName: string
  readonly moduleVersionId: string
  readonly version: number
  readonly commitSha: string
  readonly treeHash: string
  readonly artifactHash: string
  readonly approvedModuleId: string
  readonly contractId: string
  readonly contractHash: string
  readonly paths: readonly string[]
  readonly moduleTreeHash: string
}

export interface ResolvedIntegrationInput {
  readonly projectId: string
  readonly planId: string
  readonly planHash: string
  readonly baseCommit: string
  readonly requiredModules: readonly string[]
  readonly dependencies: Readonly<Record<string, readonly string[]>>
  readonly modules: readonly ResolvedModuleSnapshot[]
  readonly adapters: readonly IntegrationAdapterSpec[]
  readonly integrationTests: readonly string[]
  readonly testFiles: Readonly<Record<string, string>>
  readonly criteria: readonly IntegrationCriterion[]
  readonly interfaceMappings: readonly InterfaceMapping[]
}

export function buildInputHash(input: ResolvedIntegrationInput): string {
  return sha256({
    generator: 2,
    version: 1,
    projectId: input.projectId,
    planId: input.planId,
    planHash: input.planHash,
    baseCommit: input.baseCommit,
    requiredModules: [...input.requiredModules].sort(),
    dependencies: Object.entries(input.dependencies)
      .map(([source, targets]) => ({ source, targets: [...targets].sort() }))
      .sort((left, right) => left.source.localeCompare(right.source)),
    modules: [...input.modules]
      .map((module) => ({
        moduleId: module.moduleId,
        moduleVersionId: module.moduleVersionId,
        version: module.version,
        commitSha: module.commitSha,
        treeHash: module.treeHash,
        artifactHash: module.artifactHash,
        approvedModuleId: module.approvedModuleId,
        contractId: module.contractId,
        contractHash: module.contractHash,
        paths: [...module.paths].sort(),
      }))
      .sort((left, right) => left.moduleId.localeCompare(right.moduleId)),
    adapters: [...input.adapters]
      .map((adapter) => ({
        moduleId: adapter.moduleId,
        path: adapter.path,
        version: adapter.version,
        reason: adapter.reason,
        files: Object.entries(adapter.files)
          .map(([path, content]) => ({ path, hash: sha256(content) }))
          .sort((left, right) => left.path.localeCompare(right.path)),
        tests: [...adapter.tests],
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    integrationTests: [...input.integrationTests],
    testFiles: Object.entries(input.testFiles)
      .map(([path, content]) => ({ path, hash: sha256(content) }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    criteria: [...input.criteria]
      .map((criterion) => ({
        id: criterion.id,
        description: criterion.description,
        required: criterion.required,
        moduleId: criterion.moduleId ?? null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    interfaceMappings: [...input.interfaceMappings]
      .map((mapping) => ({
        moduleId: mapping.moduleId,
        expected: mapping.expected,
        provided: mapping.provided,
        reason: mapping.reason ?? null,
      }))
      .sort((left, right) =>
        `${left.moduleId}:${left.expected}`.localeCompare(`${right.moduleId}:${right.expected}`),
      ),
  })
}

export function buildManifest(input: {
  readonly resolved: ResolvedIntegrationInput
  readonly inputHash: string
  readonly integrationCommit: string
  readonly modules: readonly IntegrationManifestModule[]
  readonly adapters: readonly IntegrationManifestAdapter[]
  readonly integrationTests: IntegrationManifest['integrationTests']
  readonly conflicts: readonly IntegrationManifestConflict[]
  readonly createdAt: string
}): IntegrationManifest {
  return {
    kind: 'IntegrationManifest',
    version: 1,
    projectId: input.resolved.projectId,
    planId: input.resolved.planId,
    planHash: input.resolved.planHash,
    baseCommit: input.resolved.baseCommit,
    inputHash: input.inputHash,
    integrationCommit: input.integrationCommit,
    status: 'SUCCEEDED',
    modules: [...input.modules],
    adapters: [...input.adapters],
    integrationTests: [...input.integrationTests],
    criteria: [...input.resolved.criteria],
    conflicts: [...input.conflicts],
    createdAt: input.createdAt,
  }
}

export function buildManifestHash(manifest: IntegrationManifest): string {
  const { createdAt: _createdAt, ...content } = manifest
  return sha256(content)
}

export function buildAdapterSpecHash(adapter: IntegrationAdapterSpec): string {
  return sha256({
    moduleId: adapter.moduleId,
    path: adapter.path,
    version: adapter.version,
    reason: adapter.reason,
    files: Object.entries(adapter.files)
      .map(([path, content]) => ({ path, hash: sha256(content) }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    tests: adapter.tests,
  })
}

export function deterministicCommitEpoch(inputHash: string, chronologicalFloorMs: number): number {
  const parsed = Number.parseInt(inputHash.slice(0, 8), 16)
  const offset = Number.isFinite(parsed) ? parsed % 60 : 0
  return Math.floor(chronologicalFloorMs / 1000) + 1 + offset
}

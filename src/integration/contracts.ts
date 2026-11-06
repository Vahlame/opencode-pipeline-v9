import { z } from 'zod'

const NonEmptyString = z.string().min(1)

export const IntegrationCriterionSchema = z.object({
  id: NonEmptyString,
  description: NonEmptyString,
  required: z.boolean().default(true),
  moduleId: NonEmptyString.optional(),
  evidenceHint: NonEmptyString.optional(),
})
export type IntegrationCriterion = z.infer<typeof IntegrationCriterionSchema>

export const IntegrationModuleRequestSchema = z.object({
  moduleId: NonEmptyString,
  moduleVersionId: NonEmptyString.optional(),
  contractId: NonEmptyString.optional(),
})
export type IntegrationModuleRequest = z.infer<typeof IntegrationModuleRequestSchema>

export const InterfaceMappingSchema = z.object({
  moduleId: NonEmptyString,
  expected: NonEmptyString,
  provided: NonEmptyString,
  reason: NonEmptyString.optional(),
})
export type InterfaceMapping = z.infer<typeof InterfaceMappingSchema>

export const IntegrationAdapterSpecSchema = z.object({
  moduleId: NonEmptyString,
  path: z
    .string()
    .min(1)
    .refine((value) => /^integration\/adapters\/[A-Za-z0-9._/-]+$/.test(value), {
      message: 'Adapter path must live under integration/adapters/',
    }),
  version: z.number().int().positive(),
  reason: NonEmptyString,
  files: z.record(NonEmptyString, NonEmptyString),
  tests: z.array(NonEmptyString).min(1),
})
export type IntegrationAdapterSpec = z.infer<typeof IntegrationAdapterSpecSchema>

export const IntegrationRequestSchema = z.object({
  projectId: NonEmptyString,
  planId: NonEmptyString,
  modules: z.array(IntegrationModuleRequestSchema).min(1),
  requiredModules: z.array(NonEmptyString).default([]),
  dependencies: z.record(NonEmptyString, z.array(NonEmptyString)).default({}),
  integrationTests: z.array(NonEmptyString).min(1),
  testFiles: z.record(NonEmptyString, NonEmptyString).default({}),
  criteria: z.array(IntegrationCriterionSchema).default([]),
  interfaceMappings: z.array(InterfaceMappingSchema).default([]),
  adapters: z.array(IntegrationAdapterSpecSchema).default([]),
  baseRef: NonEmptyString.optional(),
})
export type IntegrationRequest = z.infer<typeof IntegrationRequestSchema>

export const TestResultSchema = z.object({
  command: NonEmptyString,
  passed: z.boolean(),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().nonnegative(),
})
export type TestResult = z.infer<typeof TestResultSchema>

export const IntegrationManifestModuleSchema = z.object({
  moduleId: NonEmptyString,
  moduleName: NonEmptyString,
  moduleVersionId: NonEmptyString,
  version: z.number().int().positive(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/i),
  treeHash: NonEmptyString,
  artifactHash: NonEmptyString,
  approvedModuleId: NonEmptyString,
  contractId: NonEmptyString,
  contractHash: NonEmptyString,
  paths: z.array(NonEmptyString).min(1),
  moduleTreeHash: NonEmptyString,
})
export type IntegrationManifestModule = z.infer<typeof IntegrationManifestModuleSchema>

export const IntegrationManifestAdapterSchema = z.object({
  moduleId: NonEmptyString,
  path: NonEmptyString,
  version: z.number().int().positive(),
  specHash: NonEmptyString,
  filesHash: NonEmptyString,
  tests: z.array(TestResultSchema).min(1),
  review: z.record(z.string(), z.unknown()),
})
export type IntegrationManifestAdapter = z.infer<typeof IntegrationManifestAdapterSchema>

export const IntegrationManifestConflictSchema = z.object({
  type: z.enum(['MINOR', 'STRUCTURAL']),
  code: NonEmptyString,
  message: NonEmptyString,
  modules: z.array(NonEmptyString),
  evidence: z.array(NonEmptyString),
  resolution: NonEmptyString.optional(),
})
export type IntegrationManifestConflict = z.infer<typeof IntegrationManifestConflictSchema>

export const IntegrationManifestSchema = z.object({
  kind: z.literal('IntegrationManifest'),
  version: z.literal(1),
  projectId: NonEmptyString,
  planId: NonEmptyString,
  planHash: NonEmptyString,
  baseCommit: z.string().regex(/^[0-9a-f]{40}$/i),
  inputHash: NonEmptyString,
  integrationCommit: z.string().regex(/^[0-9a-f]{40}$/i),
  status: z.literal('SUCCEEDED'),
  modules: z.array(IntegrationManifestModuleSchema).min(1),
  adapters: z.array(IntegrationManifestAdapterSchema),
  integrationTests: z.array(TestResultSchema).min(1),
  criteria: z.array(IntegrationCriterionSchema).min(1),
  conflicts: z.array(IntegrationManifestConflictSchema),
  createdAt: NonEmptyString,
})
export type IntegrationManifest = z.infer<typeof IntegrationManifestSchema>

export const FeedbackCriterionResultSchema = z.object({
  id: NonEmptyString,
  status: z.enum(['PASS', 'FAIL']),
  evidence: z.array(NonEmptyString).default([]),
  notes: z.string().optional(),
})
export type FeedbackCriterionResult = z.infer<typeof FeedbackCriterionResultSchema>

export const FeedbackFindingSchema = z.object({
  id: NonEmptyString,
  severity: z.enum(['INFO', 'MINOR', 'MAJOR', 'CRITICAL']),
  message: NonEmptyString,
  moduleId: NonEmptyString.optional(),
  criterionId: NonEmptyString.optional(),
  requestedAction: z.string().optional(),
  evidence: z.array(NonEmptyString).default([]),
})
export type FeedbackFinding = z.infer<typeof FeedbackFindingSchema>

export const FeedbackReportSchema = z.object({
  verdict: z.enum(['PASS', 'FAIL']),
  criteria: z.array(FeedbackCriterionResultSchema),
  findings: z.array(FeedbackFindingSchema).default([]),
  summary: NonEmptyString,
  readyForFinalDelivery: z.boolean(),
})
export type FeedbackReport = z.infer<typeof FeedbackReportSchema>

export interface FeedbackGateCheck {
  readonly code: string
  readonly passed: boolean
  readonly detail: string
}

export interface StoredFeedbackReport extends FeedbackReport {
  readonly planHash: string
  readonly manifestHash: string
  readonly checks: readonly FeedbackGateCheck[]
  readonly affectedModules: readonly string[]
  readonly agentReport?: FeedbackReport
  readonly deterministicVerdict: 'PASS' | 'FAIL'
}

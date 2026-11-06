import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { config as loadDotEnv } from 'dotenv'
import { z } from 'zod'

loadDotEnv({ quiet: true })

const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value)

const booleanFlag = z.preprocess((value) => {
  if (typeof value === 'boolean') return value
  if (value === undefined || value === null || value === '') return false
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return value
}, z.boolean())

const optionalUrl = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .url()
    .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
      message: 'OPENCODE_BASE_URL must use http or https',
    })
    .optional(),
)

export const RuntimeModeSchema = z.enum(['http', 'sdk', 'mock'])
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  OPENCODE_RUNTIME: RuntimeModeSchema.default('http'),
  OPENCODE_BASE_URL: optionalUrl,
  OPENCODE_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  OPENCODE_AGENT: z.preprocess(emptyToUndefined, z.string().min(1).default('padre')),
  OPENCODE_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  OPENCODE_PROJECT_DIR: z.preprocess(emptyToUndefined, z.string().min(1).default('.')),
  OPENCODE_REAL_TESTS: booleanFlag,
  OPENCODE_KEEP_SESSION: booleanFlag,
  OPENCODE_SDK_DATA_DIR: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  OPENCODE_SMOKE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  OPENCODE_SMOKE_PROMPT: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default('Responde únicamente con la palabra OK, sin explicación.'),
  ),
  ORCH_DB_PATH: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default('.runtime/orchestrator.db'),
  ),
  ORCH_AUTH_SECRET: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  ORCH_API_HOST: z.preprocess(emptyToUndefined, z.string().min(1).default('127.0.0.1')),
  ORCH_API_PORT: z.coerce.number().int().min(0).max(65_535).default(4400),
  ORCH_MAX_PARALLEL: z.coerce.number().int().min(1).max(16).default(2),
  ORCH_LEASE_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  ORCH_HEARTBEAT_SECONDS: z.coerce.number().int().min(2).max(1800).default(15),
  ORCH_SESSION_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(300_000),
  ORCH_TASK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  ORCH_WORKTREE_ROOT: z.preprocess(emptyToUndefined, z.string().min(1).default('.worktrees')),
  ORCH_AGENT_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  ORCH_GIT_BASE_REF: z.preprocess(emptyToUndefined, z.string().min(1).default('HEAD')),
  ORCH_MAX_REWORK_CYCLES: z.coerce.number().int().min(0).max(10).default(2),
  ORCH_JURY_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(180_000),
  ORCH_INTEGRATION_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(300_000),
  ORCH_FEEDBACK_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(300_000),
  ORCH_MAX_AGENTS: z.coerce.number().int().min(1).max(32).default(2),
  ORCH_MAX_INTEGRATION_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  ORCH_PROJECT_MAX_MINUTES: z.coerce.number().int().min(1).max(10_080).default(120),
  ORCH_MAX_PROJECT_TOKENS: z.coerce.number().int().min(1).default(2_000_000),
  ORCH_MAX_PROJECT_COST_USD: z.coerce.number().min(0).default(25),
  ORCH_INPUT_COST_PER_MILLION: z.coerce.number().min(0).default(0.15),
  ORCH_OUTPUT_COST_PER_MILLION: z.coerce.number().min(0).default(0.6),
  ORCH_RECOVERY_STALE_MINUTES: z.coerce.number().int().min(1).max(10_080).default(10),
  ORCH_RECOVERY_ON_START: booleanFlag.default(true),
  ORCH_WORKTREE_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(7),
  ORCH_OPERATION_LEASE_SECONDS: z.coerce.number().int().min(10).max(3600).default(300),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

export type AppConfig = z.infer<typeof EnvSchema> & {
  projectDir: string
  dbPath: string
  worktreeRoot: string
}

export class ConfigurationError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n${issues.join('\n')}`)
    this.name = 'ConfigurationError'
    this.issues = issues
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    throw new ConfigurationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    )
  }

  const projectDir = resolve(parsed.data.OPENCODE_PROJECT_DIR)
  const resolvedProjectDir = existsSync(projectDir) ? realpathSync.native(projectDir) : projectDir
  const dbPath =
    parsed.data.ORCH_DB_PATH === ':memory:' || isAbsolute(parsed.data.ORCH_DB_PATH)
      ? parsed.data.ORCH_DB_PATH
      : resolve(resolvedProjectDir, parsed.data.ORCH_DB_PATH)
  const worktreeRoot = isAbsolute(parsed.data.ORCH_WORKTREE_ROOT)
    ? parsed.data.ORCH_WORKTREE_ROOT
    : resolve(resolvedProjectDir, parsed.data.ORCH_WORKTREE_ROOT)
  return {
    ...parsed.data,
    projectDir: resolvedProjectDir,
    dbPath,
    worktreeRoot,
  }
}

export function parseModelRef(
  value: string | undefined,
): { providerID: string; id: string; variant?: string } | undefined {
  if (!value) return undefined
  const [modelPart, variant] = value.split('#')
  if (!modelPart) return undefined
  const slash = modelPart.indexOf('/')
  if (slash <= 0 || slash === modelPart.length - 1) {
    throw new ConfigurationError([
      `OPENCODE_MODEL: expected "provider/model" or "provider/model#variant", got "${value}"`,
    ])
  }
  return {
    providerID: modelPart.slice(0, slash),
    id: modelPart.slice(slash + 1),
    ...(variant ? { variant } : {}),
  }
}

export const env = loadConfig

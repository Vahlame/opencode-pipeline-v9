import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Command } from 'commander'
import { config as loadDotEnv } from 'dotenv'
import { loadConfig, parseModelRef } from './config/env.js'
import type { AppConfig } from './config/env.js'
import { createOpenCodeAdapter } from './opencode/factory.js'
import { runOpenCodeSmoke } from './opencode/smoke.js'
import type { OpenCodeAdapter } from './opencode/adapter.js'
import { registerPhase2Commands } from './cli/phase2.js'
import { registerPhase3Commands } from './cli/phase3.js'
import { registerPhase4Commands } from './cli/phase4.js'
import { SqliteStore } from './persistence/store.js'

loadDotEnv({ quiet: true })

const EXPECTED_AGENTS = [
  'padre',
  'coordinador',
  'frontend',
  'backend',
  'database',
  'testing',
  'debugger',
  'architecture',
  'optimizer',
  'integrador',
  'feedback',
] as const

function redact(message: string): string {
  return message.replace(/(password|token|secret|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]')
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function withAdapter(
  config: AppConfig,
  action: (adapter: OpenCodeAdapter) => Promise<void>,
): Promise<void> {
  const adapter = await createOpenCodeAdapter(config)
  try {
    await action(adapter)
  } finally {
    await adapter.close()
  }
}

async function runDoctor(config: AppConfig): Promise<void> {
  const agentFiles: string[] = await readdir(join(config.projectDir, '.opencode', 'agents')).catch(
    () => [],
  )
  const missing = EXPECTED_AGENTS.filter((agent) => !agentFiles.includes(`${agent}.md`))
  const skillsDir = join(config.projectDir, '.opencode', 'skills')
  const skills = await readdir(skillsDir, { withFileTypes: true }).catch(() => [])
  const expectedFiles = [
    'AGENTS.md',
    'opencode.jsonc',
    '.opencode/agents',
    '.opencode/skills',
  ] as const

  const store = SqliteStore.open(config.dbPath)
  const db = {
    path: config.dbPath,
    schemaVersion: store.schemaVersion,
    projects: store.countTable('projects'),
    agents: store.countTable('agents'),
    tasks: store.countTable('tasks'),
    events: store.countTable('events'),
    audit: store.countTable('audit_log'),
    outbox: store.countTable('event_outbox'),
    sessions: store.countTable('sessions'),
    worktrees: store.countTable('worktrees'),
    attempts: store.countTable('task_attempts'),
    juryRuns: store.countTable('jury_runs'),
    consolidations: store.countTable('jury_consolidations'),
    approvedModules: store.countTable('approved_modules'),
  }
  store.close()

  await withAdapter(config, async (adapter) => {
    const health = await adapter.health()
    const agents = health.ok ? await adapter.listAgents({ directory: config.projectDir }) : []
    const report = {
      phase: 4,
      node: process.version,
      authSecretConfigured: Boolean(config.ORCH_AUTH_SECRET),
      db: {
        ...db,
        juryRuns: db.juryRuns,
        consolidations: db.consolidations,
        approvedModules: db.approvedModules,
      },
      platform: `${process.platform}/${process.arch}`,
      projectDir: config.projectDir,
      runtime: config.OPENCODE_RUNTIME,
      adapter: health,
      expectedFiles: expectedFiles.map((file) => ({
        file,
        exists: existsSync(join(config.projectDir, file)),
      })),
      agentFiles: agentFiles.filter((file) => file.endsWith('.md')).sort(),
      missingAgentFiles: missing,
      skills: skills
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
      opencodeAgents: agents.map((agent) => agent.id).sort(),
      expectedAgentsRecognized: EXPECTED_AGENTS.every((agent) =>
        agents.some((candidate) => candidate.id === agent),
      ),
    }
    printJson(report)
    if (!health.ok || missing.length > 0) process.exitCode = 1
  })
}

async function runAgents(config: AppConfig): Promise<void> {
  await withAdapter(config, async (adapter) => {
    printJson(await adapter.listAgents({ directory: config.projectDir }))
  })
}

async function runSmoke(config: AppConfig, options: SmokeCommandOptions): Promise<void> {
  const timeoutMs = Number(options.timeout ?? config.OPENCODE_SMOKE_TIMEOUT_MS)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('--timeout debe ser un número positivo de milisegundos')
  }
  const model = parseModelRef(options.model ?? config.OPENCODE_MODEL)

  await withAdapter(config, async (adapter) => {
    const result = await runOpenCodeSmoke(adapter, {
      directory: config.projectDir,
      agent: options.agent ?? config.OPENCODE_AGENT,
      prompt: options.prompt ?? config.OPENCODE_SMOKE_PROMPT,
      timeoutMs,
      ...(model ? { model } : {}),
      keepSession: options.keep ?? config.OPENCODE_KEEP_SESSION,
    })
    if (options.json) {
      printJson({
        runtime: adapter.runtime,
        agent: result.agent,
        session: result.session,
        assistantText: result.assistantText,
        transcript: result.transcript,
        deleted: result.deleted,
      })
      return
    }
    process.stdout.write(`Runtime: ${adapter.runtime}\n`)
    process.stdout.write(`Agente: ${result.agent.id}\n`)
    process.stdout.write(`Sesión: ${result.session.id}\n`)
    process.stdout.write(`Sesión eliminada: ${result.deleted ? 'sí' : 'no'}\n`)
    process.stdout.write(`Respuesta:\n${result.assistantText}\n`)
  })
}

interface SmokeCommandOptions {
  agent?: string
  prompt?: string
  timeout?: string
  keep?: boolean
  model?: string
  json?: boolean
}

const program = new Command()
program
  .name('orch')
  .description('OpenCode Multiagent Orchestrator V9 - Fase 2 (núcleo persistente)')
  .version('0.4.0')

program
  .command('doctor')
  .description('Verifica entorno, perfiles y conexión con OpenCode V2')
  .action(async () => {
    await runDoctor(loadConfig())
  })

program
  .command('agents')
  .description('Lista los agentes que reconoce OpenCode')
  .action(async () => {
    await runAgents(loadConfig())
  })

program
  .command('smoke')
  .description('Crea una sesión real y ejecuta una consulta mínima')
  .option('--agent <id>', 'agente a usar')
  .option('--prompt <text>', 'prompt a enviar')
  .option('--timeout <ms>', 'timeout de la sesión')
  .option('--keep', 'conservar la sesión al terminar')
  .option('--model <provider/model>', 'modelo a usar')
  .option('--json', 'salida JSON')
  .action(async (options: SmokeCommandOptions) => {
    await runSmoke(loadConfig(), options)
  })

registerPhase2Commands(program)
registerPhase3Commands(program)
registerPhase4Commands(program)

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Error: ${redact(message)}\n`)
  process.exitCode = 1
})

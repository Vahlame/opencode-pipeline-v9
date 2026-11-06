import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpenCode } from '@opencode/sdk'
import type { AgentInfo, SessionInfo, SessionMessageInfo } from '@opencode/client'
import type {
  AdapterHealth,
  AgentSummary,
  CreateSessionInput,
  ListSessionsInput,
  ModelReference,
  OpenCodeAdapter,
  PromptInput,
  PromptReceipt,
  SessionView,
  TranscriptMessage,
} from './adapter.js'
import { OpenCodeAdapterError, SessionTimeoutError } from './errors.js'

export interface SdkAdapterOptions {
  readonly dataDir?: string
}

type SdkHost = OpenCode.Interface

const ISOLATED_ENV_KEYS = [
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME',
  'OPENCODE_DB',
] as const

function toModelReference(
  model: SessionInfo['model'] | AgentInfo['model'],
): ModelReference | undefined {
  if (!model) return undefined
  return {
    providerID: model.providerID,
    id: model.id,
    ...(model.variant ? { variant: model.variant } : {}),
  }
}

function toSessionView(info: SessionInfo): SessionView {
  return {
    id: info.id,
    projectID: info.projectID,
    ...(info.parentID ? { parentID: info.parentID } : {}),
    ...(info.agent ? { agent: info.agent } : {}),
    ...(info.model ? { model: toModelReference(info.model) } : {}),
    directory: info.location.directory,
    ...(info.title ? { title: info.title } : {}),
    createdAt: new Date(info.time.created).toISOString(),
  }
}

function toAgentSummary(info: AgentInfo): AgentSummary {
  return {
    id: info.id,
    name: info.name,
    ...(info.description ? { description: info.description } : {}),
    mode: info.mode,
    ...(info.model ? { model: toModelReference(info.model) } : {}),
  }
}

function toTranscriptMessage(message: SessionMessageInfo): TranscriptMessage | null {
  switch (message.type) {
    case 'assistant': {
      const text = message.content
        .filter((content) => content.type === 'text')
        .map((content) => content.text)
        .join('\n')
        .trim()
      return {
        id: message.id,
        role: 'assistant',
        text,
        agent: message.agent,
        createdAt: new Date(message.time.created).toISOString(),
      }
    }
    case 'user':
      return {
        id: message.id,
        role: 'user',
        text: message.text,
        createdAt: new Date(message.time.created).toISOString(),
      }
    case 'system':
    case 'synthetic':
      return {
        id: message.id,
        role: 'system',
        text: message.text,
        createdAt: new Date(message.time.created).toISOString(),
      }
    default:
      return null
  }
}

/**
 * Runtime SDK en proceso. No abre puertos: se usa para CI/headless y para
 * pruebas deterministas del ciclo de sesión. Cada instancia usa un directorio
 * temporal aislado por defecto.
 */
export class SdkOpenCodeAdapter implements OpenCodeAdapter {
  readonly runtime = 'sdk' as const
  private readonly host: SdkHost
  private readonly createdDataDir: string | undefined
  private readonly previousEnv: Partial<Record<(typeof ISOLATED_ENV_KEYS)[number], string>>
  private closed = false

  private constructor(
    host: SdkHost,
    createdDataDir: string | undefined,
    previousEnv: Partial<Record<(typeof ISOLATED_ENV_KEYS)[number], string>>,
  ) {
    this.host = host
    this.createdDataDir = createdDataDir
    this.previousEnv = previousEnv
  }

  static async create(options: SdkAdapterOptions = {}): Promise<SdkOpenCodeAdapter> {
    const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), 'orch-opencode-sdk-')))
    const createdDataDir = options.dataDir ? undefined : dataDir

    const previousEnv: Partial<Record<(typeof ISOLATED_ENV_KEYS)[number], string>> = {}
    for (const key of ISOLATED_ENV_KEYS) {
      previousEnv[key] = process.env[key]
    }

    process.env.XDG_CONFIG_HOME = join(dataDir, 'config')
    process.env.XDG_DATA_HOME = join(dataDir, 'data')
    process.env.XDG_STATE_HOME = join(dataDir, 'state')
    process.env.XDG_CACHE_HOME = join(dataDir, 'cache')
    process.env.OPENCODE_DB = join(dataDir, 'opencode.db')

    try {
      const host = await OpenCode.create()
      return new SdkOpenCodeAdapter(host, createdDataDir, previousEnv)
    } catch (error) {
      restoreEnv(previousEnv)
      if (createdDataDir) await rm(createdDataDir, { recursive: true, force: true })
      throw new OpenCodeAdapterError(
        'SDK_HOST_FAILED',
        'No se pudo crear el host embebido de OpenCode V2',
        error,
      )
    }
  }

  async health(): Promise<AdapterHealth> {
    const started = performance.now()
    try {
      const info = await this.host.server.info()
      return {
        ok: true,
        runtime: this.runtime,
        version: info.version,
        latencyMs: Math.round(performance.now() - started),
      }
    } catch (error) {
      return {
        ok: false,
        runtime: this.runtime,
        latencyMs: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async listAgents(input?: { directory?: string }): Promise<readonly AgentSummary[]> {
    const response = await this.host.agent.list({
      ...(input?.directory ? { location: { directory: input.directory } } : {}),
    })
    return response.data.map(toAgentSummary)
  }

  async createSession(input: CreateSessionInput): Promise<SessionView> {
    const session = await this.host.sessions.create({
      location: { directory: input.directory },
      agent: input.agent,
      ...(input.title ? { title: input.title } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.permissions ? { permissions: input.permissions } : {}),
      ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
    })
    return toSessionView(session)
  }

  async listSessions(input: ListSessionsInput = {}): Promise<readonly SessionView[]> {
    const response = await this.host.sessions.list({
      limit: input.limit ?? 50,
      order: 'desc',
      ...(input.directory ? { directory: input.directory } : {}),
    })
    return response.data.map(toSessionView)
  }

  async getSession(sessionID: string): Promise<SessionView | null> {
    try {
      return toSessionView(await this.host.sessions.get({ sessionID }))
    } catch {
      return null
    }
  }

  async prompt(input: PromptInput): Promise<PromptReceipt> {
    const message = await this.host.sessions.prompt({
      sessionID: input.sessionID,
      text: input.text,
      ...(input.delivery ? { delivery: input.delivery } : {}),
      ...(input.resume !== undefined ? { resume: input.resume } : {}),
    })
    return {
      sessionID: message.sessionID,
      messageID: message.id,
      createdAt: new Date(message.time.created).toISOString(),
    }
  }

  async waitForIdle(sessionID: string, timeoutMs = 120_000): Promise<void> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      await this.host.sessions.wait({ sessionID }, { signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new SessionTimeoutError(sessionID, timeoutMs)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async getTranscript(sessionID: string): Promise<readonly TranscriptMessage[]> {
    const messages: readonly SessionMessageInfo[] = await this.host.sessions.context({ sessionID })
    return messages
      .map((message) => toTranscriptMessage(message))
      .filter((message): message is TranscriptMessage => message !== null)
  }

  async deleteSession(sessionID: string): Promise<void> {
    await this.host.sessions.remove({ sessionID })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.host.close()
    restoreEnv(this.previousEnv)
    if (this.createdDataDir) {
      await rm(this.createdDataDir, { recursive: true, force: true })
    }
  }
}

function restoreEnv(previous: Partial<Record<(typeof ISOLATED_ENV_KEYS)[number], string>>): void {
  for (const key of ISOLATED_ENV_KEYS) {
    const value = previous[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

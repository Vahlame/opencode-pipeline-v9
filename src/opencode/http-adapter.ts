import { OpenCode } from '@opencode/client'
import { Service } from '@opencode/client/service'
import type { AgentInfo, SessionInfo } from '@opencode/client'
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
import { OpenCodeAdapterError, ServiceUnavailableError, SessionTimeoutError } from './errors.js'
import { toTranscriptMessage } from './transcript.js'

export interface HttpAdapterOptions {
  readonly baseUrl?: string
  readonly password?: string
  readonly headers?: Readonly<Record<string, string>>
}

type Client = ReturnType<typeof OpenCode.make>

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
    ...(info.outcome ? { outcome: info.outcome } : {}),
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

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { _tag?: string; status?: number; message?: string }
  return (
    candidate._tag === 'SessionNotFoundError' ||
    candidate.status === 404 ||
    candidate.message?.toLowerCase().includes('not found') === true
  )
}

/**
 * Runtime HTTP contra un servidor OpenCode V2. Es el runtime interactivo:
 * la app de OpenCode puede conectarse al mismo servidor y observar sesiones.
 */
export class HttpOpenCodeAdapter implements OpenCodeAdapter {
  readonly runtime = 'http' as const
  readonly baseUrl: string
  private readonly client: Client

  private constructor(client: Client, baseUrl: string) {
    this.client = client
    this.baseUrl = baseUrl
  }

  static async create(options: HttpAdapterOptions = {}): Promise<HttpOpenCodeAdapter> {
    let baseUrl = options.baseUrl
    const headers: Record<string, string> = { ...options.headers }

    if (!baseUrl) {
      const endpoint = await Service.discover()
      if (!endpoint) {
        throw new ServiceUnavailableError(
          'No hay un servidor OpenCode V2 registrado. Inicia OpenCode V2 o configura OPENCODE_BASE_URL.',
        )
      }
      baseUrl = endpoint.url
      const authHeaders = Service.headers(endpoint)
      if (authHeaders) Object.assign(headers, authHeaders)
    } else if (options.password) {
      headers.authorization = `Basic ${Buffer.from(`opencode:${options.password}`, 'utf8').toString('base64')}`
    }

    const client = OpenCode.make({ baseUrl, headers })
    return new HttpOpenCodeAdapter(client, baseUrl)
  }

  async health(): Promise<AdapterHealth> {
    const started = performance.now()
    try {
      const info = await this.client.server.info()
      return {
        ok: true,
        runtime: this.runtime,
        version: info.version,
        url: this.baseUrl,
        latencyMs: Math.round(performance.now() - started),
      }
    } catch (error) {
      return {
        ok: false,
        runtime: this.runtime,
        url: this.baseUrl,
        latencyMs: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async listAgents(input?: { directory?: string }): Promise<readonly AgentSummary[]> {
    const response = await this.client.agent.list({
      ...(input?.directory ? { location: { directory: input.directory } } : {}),
    })
    return response.data.map(toAgentSummary)
  }

  async createSession(input: CreateSessionInput): Promise<SessionView> {
    const session = await this.client.session.create({
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
    const response = await this.client.session.list({
      limit: input.limit ?? 50,
      order: 'desc',
      ...(input.directory ? { directory: input.directory } : {}),
    })
    return response.data.map(toSessionView)
  }

  async getSession(sessionID: string): Promise<SessionView | null> {
    try {
      return toSessionView(await this.client.session.get({ sessionID }))
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async prompt(input: PromptInput): Promise<PromptReceipt> {
    const message = await this.client.session.prompt({
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
      await this.client.session.wait({ sessionID }, { signal: controller.signal })
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
    const messages = await this.client.session.context({ sessionID })
    return messages
      .map(toTranscriptMessage)
      .filter((message): message is TranscriptMessage => message !== null)
  }

  async interruptSession(sessionID: string): Promise<void> {
    await this.client.session.interrupt({ sessionID, resume: false })
  }

  async deleteSession(sessionID: string): Promise<void> {
    try {
      await this.client.session.remove({ sessionID })
    } catch (error) {
      if (isNotFound(error)) return
      throw new OpenCodeAdapterError(
        'SESSION_DELETE_FAILED',
        `No se pudo eliminar la sesión ${sessionID}`,
        error,
      )
    }
  }

  async close(): Promise<void> {
    // El cliente HTTP no posee el servidor; su ciclo de vida lo gestiona OpenCode.
  }
}

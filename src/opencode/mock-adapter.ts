import type {
  AdapterHealth,
  AgentSummary,
  CreateSessionInput,
  ListSessionsInput,
  OpenCodeAdapter,
  PromptInput,
  PromptReceipt,
  SessionView,
  TranscriptMessage,
} from './adapter.js'
import { OpenCodeAdapterError } from './errors.js'

export interface MockAdapterOptions {
  readonly agents?: readonly AgentSummary[]
  readonly responseFactory?: (input: PromptInput, session: SessionView) => string
  readonly delayMs?: number
}

interface MockSession {
  readonly view: SessionView
  readonly messages: TranscriptMessage[]
}

export interface MockCall {
  readonly method: string
  readonly input: unknown
}

const DEFAULT_AGENTS: readonly AgentSummary[] = [
  { id: 'padre', name: 'Padre', mode: 'primary' },
  { id: 'coordinador', name: 'Coordinador', mode: 'primary' },
  { id: 'frontend', name: 'Frontend Specialist', mode: 'primary' },
  { id: 'backend', name: 'Backend Specialist', mode: 'primary' },
  { id: 'database', name: 'Database Specialist', mode: 'primary' },
  { id: 'testing', name: 'Testing Judge', mode: 'primary' },
  { id: 'debugger', name: 'Debug Judge', mode: 'primary' },
  { id: 'architecture', name: 'Architecture Judge', mode: 'primary' },
  { id: 'optimizer', name: 'Optimization Judge', mode: 'primary' },
  { id: 'integrador', name: 'Integrator', mode: 'primary' },
  { id: 'feedback', name: 'Feedback', mode: 'primary' },
]

/**
 * Implementación determinista. No usa OpenCode, no consume tokens y permite
 * probar el contrato del adaptador en CI.
 */
export class MockOpenCodeAdapter implements OpenCodeAdapter {
  readonly runtime = 'mock' as const
  readonly calls: MockCall[] = []

  private readonly agents: readonly AgentSummary[]
  private readonly responseFactory: (input: PromptInput, session: SessionView) => string
  private readonly delayMs: number
  private readonly sessions = new Map<string, MockSession>()
  private nextSession = 1
  private nextMessage = 1
  private clock = Date.parse('2026-01-01T00:00:00.000Z')
  private failNextPromptWith: Error | undefined

  constructor(options: MockAdapterOptions = {}) {
    this.agents = options.agents ?? DEFAULT_AGENTS
    this.responseFactory =
      options.responseFactory ?? ((input) => `Respuesta simulada para: ${input.text.slice(0, 120)}`)
    this.delayMs = options.delayMs ?? 0
  }

  failNextPrompt(error: Error): void {
    this.failNextPromptWith = error
  }

  async health(): Promise<AdapterHealth> {
    return { ok: true, runtime: this.runtime, version: 'mock-1', latencyMs: 0 }
  }

  async listAgents(input?: { directory?: string }): Promise<readonly AgentSummary[]> {
    this.calls.push({ method: 'listAgents', input })
    return this.agents
  }

  async createSession(input: CreateSessionInput): Promise<SessionView> {
    this.calls.push({ method: 'createSession', input })
    await this.delay()
    if (!this.agents.some((agent) => agent.id === input.agent)) {
      throw new OpenCodeAdapterError(
        'AGENT_NOT_FOUND',
        `El agente ${input.agent} no existe en el mock`,
      )
    }
    const id = `mock-session-${this.nextSession++}`
    const view: SessionView = {
      id,
      projectID: 'mock-project',
      agent: input.agent,
      directory: input.directory,
      ...(input.title ? { title: input.title } : {}),
      createdAt: this.now(),
    }
    this.sessions.set(id, { view, messages: [] })
    return view
  }

  async listSessions(input: ListSessionsInput = {}): Promise<readonly SessionView[]> {
    this.calls.push({ method: 'listSessions', input })
    return [...this.sessions.values()]
      .map((session) => session.view)
      .filter((session) => !input.directory || session.directory === input.directory)
      .slice(0, input.limit ?? 50)
  }

  async getSession(sessionID: string): Promise<SessionView | null> {
    this.calls.push({ method: 'getSession', input: { sessionID } })
    return this.sessions.get(sessionID)?.view ?? null
  }

  async prompt(input: PromptInput): Promise<PromptReceipt> {
    this.calls.push({ method: 'prompt', input })
    await this.delay()
    if (this.failNextPromptWith) {
      const error = this.failNextPromptWith
      this.failNextPromptWith = undefined
      throw error
    }
    const session = this.sessions.get(input.sessionID)
    if (!session) {
      throw new OpenCodeAdapterError('SESSION_NOT_FOUND', `No existe la sesión ${input.sessionID}`)
    }

    const userMessageID = `mock-message-${this.nextMessage++}`
    session.messages.push({
      id: userMessageID,
      role: 'user',
      text: input.text,
      createdAt: this.now(),
    })

    const assistantMessageID = `mock-message-${this.nextMessage++}`
    session.messages.push({
      id: assistantMessageID,
      role: 'assistant',
      text: this.responseFactory(input, session.view),
      agent: session.view.agent,
      createdAt: this.now(),
    })

    return {
      sessionID: session.view.id,
      messageID: userMessageID,
      createdAt: this.now(),
    }
  }

  async waitForIdle(sessionID: string, _timeoutMs?: number): Promise<void> {
    this.calls.push({ method: 'waitForIdle', input: { sessionID } })
    if (!this.sessions.has(sessionID)) {
      throw new OpenCodeAdapterError('SESSION_NOT_FOUND', `No existe la sesión ${sessionID}`)
    }
    await this.delay()
  }

  async getTranscript(sessionID: string): Promise<readonly TranscriptMessage[]> {
    this.calls.push({ method: 'getTranscript', input: { sessionID } })
    const session = this.sessions.get(sessionID)
    if (!session) {
      throw new OpenCodeAdapterError('SESSION_NOT_FOUND', `No existe la sesión ${sessionID}`)
    }
    return [...session.messages]
  }

  async interruptSession(sessionID: string): Promise<void> {
    this.calls.push({ method: 'interruptSession', input: { sessionID } })
    if (!this.sessions.has(sessionID)) {
      throw new OpenCodeAdapterError('SESSION_NOT_FOUND', `No existe la sesión ${sessionID}`)
    }
  }

  async deleteSession(sessionID: string): Promise<void> {
    this.calls.push({ method: 'deleteSession', input: { sessionID } })
    this.sessions.delete(sessionID)
  }

  async close(): Promise<void> {
    this.calls.push({ method: 'close', input: undefined })
  }

  private now(): string {
    this.clock += 1000
    return new Date(this.clock).toISOString()
  }

  private async delay(): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    }
  }
}

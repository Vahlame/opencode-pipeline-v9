export type AdapterRuntime = 'http' | 'sdk' | 'mock'

export interface AdapterHealth {
  readonly ok: boolean
  readonly runtime: AdapterRuntime
  readonly version?: string
  readonly url?: string
  readonly latencyMs?: number
  readonly error?: string
}

export interface OpenCodePermissionRule {
  readonly action: string
  readonly resource: string
  readonly effect: 'allow' | 'deny' | 'ask'
}

export interface ModelReference {
  readonly providerID: string
  readonly id: string
  readonly variant?: string
}

export interface AgentSummary {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly mode: 'primary' | 'subagent' | 'all'
  readonly model?: ModelReference
}

export interface SessionView {
  readonly id: string
  readonly projectID: string
  readonly parentID?: string
  readonly agent?: string
  readonly model?: ModelReference
  readonly directory: string
  readonly title?: string
  readonly createdAt?: string
}

export interface CreateSessionInput {
  readonly directory: string
  readonly agent: string
  readonly title?: string
  readonly model?: ModelReference
  readonly permissions?: ReadonlyArray<OpenCodePermissionRule>
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>
}

export interface ListSessionsInput {
  readonly directory?: string
  readonly limit?: number
}

export interface PromptInput {
  readonly sessionID: string
  readonly text: string
  readonly delivery?: 'steer' | 'queue'
  readonly resume?: boolean
}

export interface PromptReceipt {
  readonly sessionID: string
  readonly messageID: string
  readonly createdAt?: string
}

export type TranscriptRole = 'user' | 'assistant' | 'system' | 'other'

export interface TranscriptMessage {
  readonly id: string
  readonly role: TranscriptRole
  readonly text: string
  readonly agent?: string
  readonly createdAt?: string
}

/**
 * Frontera entre el orquestador y OpenCode. El núcleo no debe importar
 * @opencode/client ni @opencode/sdk directamente.
 */
export interface OpenCodeAdapter {
  readonly runtime: AdapterRuntime

  health(): Promise<AdapterHealth>

  listAgents(input?: { readonly directory?: string }): Promise<readonly AgentSummary[]>

  createSession(input: CreateSessionInput): Promise<SessionView>

  listSessions(input?: ListSessionsInput): Promise<readonly SessionView[]>

  getSession(sessionID: string): Promise<SessionView | null>

  prompt(input: PromptInput): Promise<PromptReceipt>

  waitForIdle(sessionID: string, timeoutMs?: number): Promise<void>

  getTranscript(sessionID: string): Promise<readonly TranscriptMessage[]>

  deleteSession(sessionID: string): Promise<void>

  close(): Promise<void>
}

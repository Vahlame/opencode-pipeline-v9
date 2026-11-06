import type {
  AgentSummary,
  ModelReference,
  OpenCodeAdapter,
  SessionView,
  TranscriptMessage,
} from './adapter.js'
import { OpenCodeAdapterError } from './errors.js'

export interface SmokeOptions {
  readonly directory: string
  readonly agent: string
  readonly prompt: string
  readonly timeoutMs?: number
  readonly model?: ModelReference
  readonly keepSession?: boolean
}

export interface SmokeResult {
  readonly agent: AgentSummary
  readonly session: SessionView
  readonly assistantText: string
  readonly transcript: readonly TranscriptMessage[]
  readonly deleted: boolean
}

/**
 * Prueba mínima de extremo a extremo del adaptador: crea una sesión real,
 * envía un prompt, espera a que termine y recupera la respuesta.
 */
export async function runOpenCodeSmoke(
  adapter: OpenCodeAdapter,
  options: SmokeOptions,
): Promise<SmokeResult> {
  const agents = await adapter.listAgents({ directory: options.directory })
  const agent = agents.find((candidate) => candidate.id === options.agent)
  if (!agent) {
    throw new OpenCodeAdapterError(
      'AGENT_NOT_FOUND',
      `OpenCode no reconoce el agente "${options.agent}". Perfiles disponibles: ${agents
        .map((candidate) => candidate.id)
        .join(', ')}`,
    )
  }

  const session = await adapter.createSession({
    directory: options.directory,
    agent: options.agent,
    title: `Smoke Fase 1 - ${options.agent}`,
    ...(options.model ? { model: options.model } : {}),
    metadata: { source: 'phase-1-smoke', agent: options.agent },
  })

  let deleted = false
  try {
    await adapter.prompt({
      sessionID: session.id,
      text: options.prompt,
      delivery: 'queue',
    })
    await adapter.waitForIdle(session.id, options.timeoutMs ?? 120_000)
    const transcript = await adapter.getTranscript(session.id)
    const assistantText =
      [...transcript].reverse().find((message) => message.role === 'assistant')?.text ?? ''

    if (!assistantText.trim()) {
      throw new OpenCodeAdapterError(
        'EMPTY_RESPONSE',
        `La sesión ${session.id} terminó sin una respuesta de texto del asistente`,
      )
    }

    if (!options.keepSession) {
      await adapter.deleteSession(session.id)
      deleted = true
    }

    return { agent, session, assistantText, transcript, deleted }
  } catch (error) {
    if (!options.keepSession) {
      try {
        await adapter.deleteSession(session.id)
        deleted = true
      } catch {
        // La sesión se conserva para diagnóstico; no ocultamos el error original.
      }
    }
    throw error
  }
}

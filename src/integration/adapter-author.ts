import type { AppConfig } from '../config/env.js'
import { parseModelRef } from '../config/env.js'
import type { Contract, Module } from '../domain/index.js'
import type { ProjectId } from '../domain/ids.js'
import type { SqliteStore } from '../persistence/store.js'
import type { SessionManager } from '../sessions/manager.js'
import { redactText } from '../security/redaction.js'
import {
  IntegrationAdapterSpecSchema,
  type IntegrationAdapterSpec,
  type InterfaceMapping,
} from './contracts.js'

export interface AdapterAuthorInput {
  readonly projectId: ProjectId
  readonly module: Module
  readonly contract: Contract
  readonly commitSha: string
  readonly mapping: InterfaceMapping
}

export interface AdapterAuthor {
  propose(input: AdapterAuthorInput): Promise<IntegrationAdapterSpec>
}

/**
 * Autor de adaptadores asistido por el agente integrador. El agente solo
 * propone archivos; el orquestador valida rutas, escribe en el workspace,
 * ejecuta sus pruebas y decide si el adaptador se versiona.
 */
export class OpenCodeAdapterAuthor implements AdapterAuthor {
  constructor(
    private readonly store: SqliteStore,
    private readonly sessions: SessionManager,
    private readonly config: AppConfig,
  ) {}

  async propose(input: AdapterAuthorInput): Promise<IntegrationAdapterSpec> {
    const agent = this.store.getAgentByOpenCodeId(input.projectId, 'integrador')
    if (!agent) throw new Error('Integrator agent not found')
    const model = parseModelRef(this.config.ORCH_AGENT_MODEL ?? this.config.OPENCODE_MODEL)
    const session = await this.sessions.createReadOnlySession({
      projectId: input.projectId,
      agent,
      directory: this.config.projectDir,
      title: `Adapter proposal - ${input.module.name}`,
      metadata: {
        role: 'INTEGRATOR',
        moduleId: input.module.id,
        commitSha: input.commitSha,
      },
      ...(model ? { model } : {}),
    })
    try {
      await this.sessions.prompt(session.record, this.prompt(input, agent.name))
      const transcript = await this.sessions.wait(
        session.record,
        this.config.ORCH_INTEGRATION_TIMEOUT_MS,
      )
      const text =
        [...transcript].reverse().find((message) => message.role === 'assistant')?.text ?? ''
      return this.parse(text, input)
    } catch (error) {
      throw new Error(
        `Adapter author failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }

  private prompt(input: AdapterAuthorInput, agentName: string): string {
    return [
      `Eres ${agentName} (INTEGRATOR) y propones un adaptador menor.`,
      'No edites archivos, no ejecutes shell, no uses subagentes y no modifiques modulos aprobados.',
      'El orquestador escribira tu propuesta, ejecutara sus pruebas y decidira si es valida.',
      `Modulo aprobado: ${input.module.name}`,
      `Commit: ${input.commitSha}`,
      `Path scope: ${JSON.stringify(input.module.pathScope)}`,
      `Contrato: ${JSON.stringify(input.contract, null, 2)}`,
      `Interfaz esperada: ${input.mapping.expected}`,
      `Interfaz provista: ${input.mapping.provided}`,
      `Motivo: ${input.mapping.reason ?? 'diferenciar de interfaz menor'}`,
      '',
      'Devuelve EXCLUSIVAMENTE un JSON valido, sin Markdown, con esta forma:',
      JSON.stringify(
        {
          moduleId: input.module.id,
          path: 'integration/adapters/<nombre>.mjs',
          version: 1,
          reason: 'string',
          files: {
            'integration/adapters/<nombre>.mjs': 'export function ...',
            'integration/adapters/<nombre>.test.mjs': 'test source',
          },
          tests: ['node integration/adapters/<nombre>.test.mjs'],
        },
        null,
        2,
      ),
      '',
      'Todos los archivos deben quedar bajo integration/adapters/. No propongas cambios en modules/.',
      'El adaptador debe importar la interfaz aprobada y exponer la interfaz esperada.',
      'La prueba debe ejecutarse con node y usar una ruta incluida en files.',
    ].join('\n')
  }

  private parse(text: string, input: AdapterAuthorInput): IntegrationAdapterSpec {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('Adapter author response did not contain JSON')
    let parsed: unknown
    try {
      parsed = JSON.parse(text.slice(start, end + 1))
    } catch (error) {
      throw new Error(
        `Adapter author JSON parse failed: ${redactText(error instanceof Error ? error.message : String(error))}`,
        { cause: error },
      )
    }
    const adapter = IntegrationAdapterSpecSchema.parse(parsed)
    if (adapter.moduleId !== input.module.id) {
      throw new Error('Adapter author proposed an adapter for another module')
    }
    return adapter
  }
}

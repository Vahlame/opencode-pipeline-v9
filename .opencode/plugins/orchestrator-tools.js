import { define } from '@opencode/plugin'
import { config as loadDotEnv } from 'dotenv'

loadDotEnv({ quiet: true })

const apiUrl = process.env.ORCH_TOOL_API_URL ?? 'http://127.0.0.1:4400'
const toolSecret = process.env.ORCH_TOOL_SECRET ?? ''

async function call(path, body) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-orch-tool-secret': toolSecret,
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Orchestrator tool ${path} failed: ${text}`)
  return text
}

function result(text) {
  return { content: [{ type: 'text', text }] }
}

export default define({
  id: 'orchestrator-tools',
  async setup(context) {
    await context.tool.transform((tools) => {
      tools.add({
        name: 'orchestrator_state',
        description: 'Lee el estado compartido del proyecto desde el orquestador.',
        input: {
          type: 'object',
          properties: { projectId: { type: 'string' } },
          required: ['projectId'],
          additionalProperties: false,
        },
        async execute(input) {
          return result(await call('/api/tools/state', input))
        },
      })

      tools.add({
        name: 'orchestrator_inbox',
        description: 'Lee los mensajes privados autorizados del agente actual.',
        input: {
          type: 'object',
          properties: {
            projectId: { type: 'string' },
            agentId: { type: 'string' },
          },
          required: ['agentId'],
          additionalProperties: false,
        },
        async execute(input) {
          return result(await call('/api/tools/inbox', input))
        },
      })

      tools.add({
        name: 'orchestrator_send',
        description: 'Envia un mensaje mediante el sistema de permisos del orquestador.',
        input: {
          type: 'object',
          properties: {
            projectId: { type: 'string' },
            fromAgentId: { type: 'string' },
            toAgentId: { type: 'string' },
            correlationId: { type: 'string' },
            kind: { type: 'string', enum: ['INFO', 'QUERY', 'ORDER', 'PAUSE', 'CANCEL'] },
            payload: { type: 'object' },
            idempotencyKey: { type: 'string' },
          },
          required: ['fromAgentId', 'toAgentId', 'idempotencyKey'],
          additionalProperties: false,
        },
        async execute(input) {
          return result(
            await call('/api/tools/send', {
              ...input,
              correlationId: input.correlationId ?? `tool:${input.idempotencyKey}`,
            }),
          )
        },
      })

      tools.add({
        name: 'orchestrator_delivery',
        description: 'Consulta la entrega final del proyecto.',
        input: {
          type: 'object',
          properties: { projectId: { type: 'string' } },
          required: ['projectId'],
          additionalProperties: false,
        },
        async execute(input) {
          return result(await call('/api/tools/delivery', input))
        },
      })

      tools.add({
        name: 'orchestrator_math_run',
        description:
          'Ejecuta un script matematico dentro del repositorio con Python o Node y devuelve hardware y evidencia.',
        input: {
          type: 'object',
          properties: {
            projectId: { type: 'string' },
            script: { type: 'string' },
            interpreter: { type: 'string', enum: ['auto', 'python', 'node'] },
            timeoutMs: { type: 'number' },
          },
          required: ['projectId', 'script'],
          additionalProperties: false,
        },
        async execute(input) {
          return result(await call('/api/tools/math/run', input))
        },
      })
    })
  },
})

import { TokenService } from '../../src/auth/tokens.js'
import { AuthorizationService } from '../../src/auth/authorization.js'
import type { AgentRole } from '../../src/domain/enums.js'
import type { Agent, Plan, Project } from '../../src/domain/index.js'
import type { Principal } from '../../src/auth/types.js'
import { OrchestratorService } from '../../src/orchestrator/service.js'
import { SqliteStore } from '../../src/persistence/store.js'

export const TEST_SECRET = 'test-secret-for-phase-2-do-not-use-in-production'

export interface CoreFixture {
  readonly store: SqliteStore
  readonly service: OrchestratorService
  readonly tokens: TokenService
  readonly human: string
  readonly project: Project
  readonly agents: readonly Agent[]
  readonly agentByCode: ReadonlyMap<string, Agent>
  tokenFor(code: string, role?: AgentRole): string
  principalFor(code: string, role?: AgentRole): Principal
  approveAndStart(title?: string): Plan
  close(): void
}

export function createCoreFixture(repoPath = 'C:/test/repo'): CoreFixture {
  const store = SqliteStore.open(':memory:')
  const authz = new AuthorizationService(store)
  const tokens = new TokenService(TEST_SECRET)
  const service = new OrchestratorService(store, authz)

  const human = tokens.issue({ subjectId: 'human', kind: 'HUMAN', role: 'HUMAN' })
  const humanPrincipal = tokens.verify(human)
  const project = service.createProject(humanPrincipal, {
    name: `Test ${Math.random().toString(16).slice(2)}`,
    repoPath,
  })
  const agents = service.bootstrapAgents(humanPrincipal, project.id)
  const agentByCode = new Map(agents.map((agent) => [agent.opencodeAgentId, agent]))

  const principalFor = (code: string, role?: AgentRole): Principal => {
    const agent = agentByCode.get(code)
    if (!agent) throw new Error(`Agent ${code} not found`)
    return {
      subjectId: agent.id,
      kind: 'AGENT',
      role: role ?? agent.role,
      projectId: project.id,
      agentId: agent.id,
    }
  }

  const tokenFor = (code: string, role?: AgentRole): string =>
    tokens.issue(principalFor(code, role))

  const approveAndStart = (title = 'Test plan'): Plan => {
    const plan = service.createPlan(tokens.verify(tokenFor('padre')), {
      projectId: project.id,
      title,
      spec: { objective: 'test' },
      plan: { steps: ['one'] },
    })
    service.approvePlan(tokens.verify(human), plan.id, plan.hash)
    service.startProject(tokens.verify(human), project.id)
    return plan
  }

  return {
    store,
    service,
    tokens,
    human,
    project,
    agents,
    agentByCode,
    tokenFor,
    principalFor,
    approveAndStart,
    close: () => store.close(),
  }
}

import { loadConfig } from '../config/env.js'
import type { AppConfig } from '../config/env.js'
import { TokenService } from '../auth/tokens.js'
import { AuthorizationService } from '../auth/authorization.js'
import { OrchestratorService } from '../orchestrator/service.js'
import { SqliteStore } from '../persistence/store.js'
import { ResourceGovernor } from '../resources/governor.js'

export interface AppContext {
  readonly config: AppConfig
  readonly store: SqliteStore
  readonly authz: AuthorizationService
  readonly tokens: TokenService
  readonly service: OrchestratorService
  readonly resources: ResourceGovernor
  close(): void
}

export function createAppContext(config: AppConfig = loadConfig()): AppContext {
  if (!config.ORCH_AUTH_SECRET) {
    throw new Error(
      'ORCH_AUTH_SECRET is required. Add a long random secret to .env before using the Phase 2 core.',
    )
  }
  const store = SqliteStore.open(config.dbPath)
  const authz = new AuthorizationService(store)
  const tokens = new TokenService(config.ORCH_AUTH_SECRET)
  const service = new OrchestratorService(store, authz)
  const resources = ResourceGovernor.fromConfig(store, config)
  return {
    config,
    store,
    authz,
    tokens,
    service,
    resources,
    close: () => store.close(),
  }
}

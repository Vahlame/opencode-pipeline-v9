import type { Agent, Contract, Module, Task } from '../domain/index.js'
import type { TaskAttemptRecord } from '../persistence/store.js'

export interface TaskClaim {
  readonly task: Task
  readonly agent: Agent
  readonly contract: Contract
  readonly module?: Module
  readonly attempt: TaskAttemptRecord
}

export interface TaskExecutionResult {
  readonly taskId: string
  readonly status: 'SUCCEEDED' | 'FAILED' | 'BLOCKED'
  readonly sessionId?: string
  readonly commitSha?: string
  readonly error?: string
  readonly startedAt: string
  readonly endedAt: string
}

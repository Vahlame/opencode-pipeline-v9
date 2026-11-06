import type { OperationRecord, SqliteStore } from '../persistence/store.js'
import type { ProjectId } from '../domain/ids.js'

export interface OperationInput {
  readonly projectId: ProjectId
  readonly kind: string
  readonly idempotencyKey: string
  readonly inputHash: string
  readonly leaseSeconds: number
}

export interface OperationRunResult<T extends Record<string, unknown>> {
  readonly operation: OperationRecord
  readonly value: T
  readonly reused: boolean
}

/**
 * Diario de operaciones con clave idempotente, lease y resultado durable.
 * Un RUNNING con lease vigente no se ejecuta dos veces; un lease vencido se
 * toma como reintento y un COMPLETED devuelve el resultado almacenado.
 */
export class OperationService {
  constructor(private readonly store: SqliteStore) {}

  async run<T extends Record<string, unknown>>(
    input: OperationInput,
    action: () => Promise<T> | T,
  ): Promise<OperationRunResult<T>> {
    const started = this.store.beginOperation(input)
    if (started.operation.status === 'COMPLETED' && started.operation.result) {
      return {
        operation: started.operation,
        value: started.operation.result as T,
        reused: true,
      }
    }
    try {
      const value = await action()
      const operation = this.store.completeOperation(started.operation.id, value)
      return { operation, value, reused: started.reused }
    } catch (error) {
      this.store.failOperation(
        started.operation.id,
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      )
      throw error
    }
  }
}

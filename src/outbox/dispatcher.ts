import type { SqliteStore } from '../persistence/store.js'
import { addSecondsIso } from '../domain/id-factory.js'

export interface OutboxItem {
  readonly id: string
  readonly eventId: string
  readonly topic: string
  readonly payload: Record<string, unknown>
  readonly attempts: number
}

export interface OutboxHandler {
  handle(item: OutboxItem): Promise<void> | void
}

export interface OutboxDispatchResult {
  readonly delivered: number
  readonly retried: number
  readonly failed: number
}

/**
 * Entrega de la outbox con reintentos acotados. El handler debe ser idempotente
 * porque un evento puede reentregarse después de un fallo de proceso.
 */
export class OutboxDispatcher {
  constructor(
    private readonly store: SqliteStore,
    private readonly handler: OutboxHandler,
    private readonly options: { maxAttempts?: number; retryDelaySeconds?: number } = {},
  ) {}

  async dispatch(limit = 100): Promise<OutboxDispatchResult> {
    const maxAttempts = this.options.maxAttempts ?? 5
    const retryDelaySeconds = this.options.retryDelaySeconds ?? 30
    let delivered = 0
    let retried = 0
    let failed = 0

    for (const item of this.store.listPendingOutbox(limit)) {
      const outboxItem: OutboxItem = {
        id: String(item['id']),
        eventId: String(item['eventId']),
        topic: String(item['topic']),
        payload: (item['payload'] as Record<string, unknown>) ?? {},
        attempts: Number(item['attempts'] ?? 0),
      }
      try {
        await this.handler.handle(outboxItem)
        this.store.markOutboxDelivered(outboxItem.id)
        delivered += 1
      } catch (error) {
        const nextAttempt = outboxItem.attempts + 1
        const final = nextAttempt >= maxAttempts
        this.store.markOutboxFailed(
          outboxItem.id,
          error instanceof Error ? error.message : String(error),
          final ? null : addSecondsIso(retryDelaySeconds),
          final,
        )
        if (final) failed += 1
        else retried += 1
      }
    }

    return { delivered, retried, failed }
  }
}

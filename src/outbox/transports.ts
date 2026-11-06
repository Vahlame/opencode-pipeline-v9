import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { OutboxHandler, OutboxItem } from './dispatcher.js'

export class FileOutboxHandler implements OutboxHandler {
  private readonly path: string

  constructor(path: string) {
    this.path = resolve(path)
    mkdirSync(dirname(this.path), { recursive: true })
  }

  handle(item: OutboxItem): void {
    appendFileSync(
      this.path,
      `${JSON.stringify({ ...item, deliveredBy: 'file-outbox', deliveredAt: new Date().toISOString() })}\n`,
      'utf8',
    )
  }
}

export class WebhookOutboxHandler implements OutboxHandler {
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 15_000,
  ) {}

  async handle(item: OutboxItem): Promise<void> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item),
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`Webhook returned HTTP ${response.status}`)
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

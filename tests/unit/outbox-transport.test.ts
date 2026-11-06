import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileOutboxHandler } from '../../src/outbox/transports.js'

let root: string | undefined

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = undefined
})

describe('file outbox transport', () => {
  it('appends durable JSON lines', () => {
    root = mkdtempSync(join(tmpdir(), 'orch-outbox-'))
    const path = join(root, 'outbox.ndjson')
    const handler = new FileOutboxHandler(path)
    handler.handle({
      id: 'obx_1',
      eventId: 'evt_1',
      topic: 'test',
      payload: { ok: true },
      attempts: 0,
    })
    handler.handle({
      id: 'obx_2',
      eventId: 'evt_2',
      topic: 'test',
      payload: { ok: true },
      attempts: 0,
    })
    const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/)
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).eventId).toBe('evt_1')
    expect(JSON.parse(lines[1]!).deliveredBy).toBe('file-outbox')
  })
})

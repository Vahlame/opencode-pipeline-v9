import { describe, expect, it } from 'vitest'
import { SqliteStore, StoreConflictError } from '../../src/persistence/store.js'
import { OperationService } from '../../src/operations/service.js'
import type { ProjectId } from '../../src/domain/ids.js'

describe('operation journal', () => {
  it('deduplicates completed operations and prevents concurrent duplicates', async () => {
    const store = SqliteStore.open(':memory:')
    try {
      const project = store.createProject({ name: 'Operations', repoPath: 'C:/operations' })
      const service = new OperationService(store)
      let calls = 0
      const input = {
        projectId: project.id as ProjectId,
        kind: 'integration',
        idempotencyKey: 'same-input',
        inputHash: 'hash',
        leaseSeconds: 60,
      }
      const first = await service.run(input, () => {
        calls += 1
        return { manifest: 'one' }
      })
      const second = await service.run(input, () => {
        calls += 1
        return { manifest: 'two' }
      })
      expect(first.reused).toBe(false)
      expect(second.reused).toBe(true)
      expect(second.value.manifest).toBe('one')
      expect(calls).toBe(1)

      store.beginOperation({
        projectId: project.id as ProjectId,
        kind: 'integration',
        idempotencyKey: 'active',
        inputHash: 'active-hash',
        leaseSeconds: 60,
      })
      await expect(
        service.run(
          {
            ...input,
            idempotencyKey: 'active',
            inputHash: 'active-hash',
          },
          () => ({ manifest: 'never' }),
        ),
      ).rejects.toBeInstanceOf(StoreConflictError)
    } finally {
      store.close()
    }
  })

  it('takes over an expired lease exactly once', async () => {
    const store = SqliteStore.open(':memory:')
    try {
      const project = store.createProject({ name: 'Operations expired', repoPath: 'C:/ops2' })
      const service = new OperationService(store)
      const started = store.beginOperation({
        projectId: project.id as ProjectId,
        kind: 'recovery',
        idempotencyKey: 'expired',
        inputHash: 'hash',
        leaseSeconds: 60,
      })
      store.db.run('UPDATE operations SET lease_expires_at = ? WHERE id = ?', [
        '2020-01-01T00:00:00.000Z',
        started.operation.id,
      ])
      const result = await service.run(
        {
          projectId: project.id as ProjectId,
          kind: 'recovery',
          idempotencyKey: 'expired',
          inputHash: 'hash',
          leaseSeconds: 60,
        },
        () => ({ recovered: true }),
      )
      expect(result.reused).toBe(true)
      expect(result.operation.attempts).toBe(2)
      expect(result.value.recovered).toBe(true)
    } finally {
      store.close()
    }
  })
})

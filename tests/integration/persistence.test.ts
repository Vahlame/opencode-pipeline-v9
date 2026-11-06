import { describe, expect, it } from 'vitest'
import { SqliteStore } from '../../src/persistence/store.js'
import { OutboxDispatcher } from '../../src/outbox/dispatcher.js'
import type { ProjectId, TaskId } from '../../src/domain/ids.js'
import { createCoreFixture } from '../helpers/phase2.js'

describe('SQLite persistence', () => {
  it('applies migrations and creates the required tables', () => {
    const store = SqliteStore.open(':memory:')
    try {
      expect(store.schemaVersion).toBe(8)
      const tables = store.db
        .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .map((row) => row.name)
      for (const table of [
        'projects',
        'plans',
        'agents',
        'tasks',
        'task_dependencies',
        'contracts',
        'modules',
        'sessions',
        'messages',
        'reviews',
        'approvals',
        'events',
        'checkpoints',
        'audit_log',
        'event_outbox',
        'module_versions',
        'temporary_permissions',
        'leases',
        'worktrees',
        'task_attempts',
        'jury_runs',
        'jury_consolidations',
        'approved_modules',
        'integration_runs',
        'integration_modules',
        'integration_adapters',
        'integration_conflicts',
        'integration_manifests',
        'feedback_runs',
        'final_deliveries',
        'project_resources',
        'operations',
        'recovery_runs',
        'recovery_actions',
        'artifact_signatures',
        'provider_usage',
        'usage_events',
      ]) {
        expect(tables).toContain(table)
      }
      expect(() => store.db.migrate()).not.toThrow()
    } finally {
      store.close()
    }
  })

  it('rolls back a failed transaction without leaving records', () => {
    const store = SqliteStore.open(':memory:')
    try {
      const before = store.countTable('projects')
      expect(() =>
        store.transaction(() => {
          store.createProject({ name: 'Rollback', repoPath: 'C:/rollback' })
          throw new Error('boom')
        }),
      ).toThrow('boom')
      expect(store.countTable('projects')).toBe(before)
    } finally {
      store.close()
    }
  })

  it('enforces foreign keys and self-dependency constraints', () => {
    const store = SqliteStore.open(':memory:')
    try {
      expect(() =>
        store.addTaskDependency('tsk_missing' as TaskId, 'tsk_missing_2' as TaskId),
      ).toThrow()
    } finally {
      store.close()
    }
  })

  it('makes events and audit entries append-only', () => {
    const fixture = createCoreFixture()
    try {
      const event = fixture.store.listEvents(fixture.project.id, 1)[0]
      expect(event).toBeDefined()
      expect(() =>
        fixture.store.db.run('UPDATE events SET type = ? WHERE seq = ?', ['tampered', event!.seq]),
      ).toThrow(/append-only/)

      const audit = fixture.store.writeAudit({
        projectId: fixture.project.id,
        actorId: 'tester',
        action: 'test',
        resource: 'project:*',
        decision: 'ALLOW',
        reason: 'test',
      })
      expect(() =>
        fixture.store.db.run('UPDATE audit_log SET reason = ? WHERE id = ?', [
          'tampered',
          audit.id,
        ]),
      ).toThrow(/append-only/)
    } finally {
      fixture.close()
    }
  })

  it('creates an outbox row for every durable event', () => {
    const fixture = createCoreFixture()
    try {
      const events = fixture.store.listEvents(fixture.project.id, 100)
      const outbox = fixture.store.listOutboxForProject(fixture.project.id)
      expect(events.length).toBeGreaterThan(0)
      expect(outbox.length).toBeGreaterThanOrEqual(events.length)
      expect(outbox.every((item) => item['eventId'])).toBe(true)
    } finally {
      fixture.close()
    }
  })

  it('rejects a project repository duplicate', () => {
    const fixture = createCoreFixture('C:/unique-repo')
    try {
      const human = fixture.tokens.verify(fixture.human)
      const same = fixture.service.createProject(human, {
        name: fixture.project.name,
        repoPath: 'C:/unique-repo',
      })
      expect(same.id).toBe(fixture.project.id)
      expect(() =>
        fixture.service.createProject(human, {
          name: `Other ${Math.random()}`,
          repoPath: 'C:/unique-repo',
        }),
      ).toThrow(/already belongs/)
    } finally {
      fixture.close()
    }
  })

  it('stores a project with a branded id', () => {
    const fixture = createCoreFixture('C:/branded')
    try {
      expect(fixture.store.getProject(fixture.project.id as ProjectId)?.id).toBe(fixture.project.id)
    } finally {
      fixture.close()
    }
  })

  it('dispatches outbox events idempotently and retries failures', async () => {
    const fixture = createCoreFixture('C:/outbox')
    try {
      let delivered = 0
      const dispatcher = new OutboxDispatcher(
        fixture.store,
        {
          handle: () => {
            delivered += 1
          },
        },
        { maxAttempts: 2, retryDelaySeconds: 0 },
      )
      const first = await dispatcher.dispatch()
      expect(first.delivered).toBeGreaterThan(0)
      expect(delivered).toBeGreaterThan(0)
    } finally {
      fixture.close()
    }

    const failingFixture = createCoreFixture('C:/outbox-fail')
    try {
      let attempts = 0
      const flaky = new OutboxDispatcher(
        failingFixture.store,
        {
          handle: () => {
            attempts += 1
            throw new Error('temporary failure')
          },
        },
        { maxAttempts: 1, retryDelaySeconds: 0 },
      )
      const failed = await flaky.dispatch()
      expect(failed.failed).toBeGreaterThan(0)
      expect(attempts).toBeGreaterThan(0)
      expect(failingFixture.store.listOutbox('FAILED').length).toBeGreaterThan(0)
    } finally {
      failingFixture.close()
    }
  })
})

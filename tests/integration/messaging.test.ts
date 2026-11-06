import { describe, expect, it } from 'vitest'
import { createCoreFixture } from '../helpers/phase2.js'

describe('persistent messaging', () => {
  it('deduplicates messages by idempotency key', () => {
    const fixture = createCoreFixture('C:/msg-dedup')
    try {
      fixture.approveAndStart()
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      const frontend = fixture.agentByCode.get('frontend')!
      const eventCount = fixture.store.countTable('events')

      const first = fixture.service.sendMessage(coordinator, {
        projectId: fixture.project.id,
        toAgentId: frontend.id,
        correlationId: 'corr-1',
        kind: 'INFO',
        payload: { text: 'hola' },
        idempotencyKey: 'dedup-1',
      })
      const second = fixture.service.sendMessage(coordinator, {
        projectId: fixture.project.id,
        toAgentId: frontend.id,
        correlationId: 'corr-1',
        kind: 'INFO',
        payload: { text: 'hola' },
        idempotencyKey: 'dedup-1',
      })

      expect(first.duplicate).toBe(false)
      expect(second.duplicate).toBe(true)
      expect(second.message.id).toBe(first.message.id)
      expect(fixture.store.countTable('messages')).toBe(1)
      expect(fixture.store.countTable('events')).toBe(eventCount + 1)
    } finally {
      fixture.close()
    }
  })

  it('rejects a duplicate key with different content', () => {
    const fixture = createCoreFixture('C:/msg-conflict')
    try {
      fixture.approveAndStart()
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      const frontend = fixture.agentByCode.get('frontend')!
      fixture.service.sendMessage(coordinator, {
        projectId: fixture.project.id,
        toAgentId: frontend.id,
        correlationId: 'corr-1',
        kind: 'INFO',
        payload: { text: 'uno' },
        idempotencyKey: 'same-key',
      })

      expect(() =>
        fixture.service.sendMessage(coordinator, {
          projectId: fixture.project.id,
          toAgentId: frontend.id,
          correlationId: 'corr-1',
          kind: 'INFO',
          payload: { text: 'dos' },
          idempotencyKey: 'same-key',
        }),
      ).toThrow(/different message/)
    } finally {
      fixture.close()
    }
  })

  it('denies unauthorized orders and records the rejection', () => {
    const fixture = createCoreFixture('C:/msg-order-denied')
    try {
      fixture.approveAndStart()
      const frontend = fixture.tokens.verify(fixture.tokenFor('frontend'))
      const coordinator = fixture.agentByCode.get('coordinador')!
      const before = fixture.store.countTable('messages')

      expect(() =>
        fixture.service.sendMessage(frontend, {
          projectId: fixture.project.id,
          toAgentId: coordinator.id,
          correlationId: 'corr-order',
          kind: 'ORDER',
          payload: { text: 'haz esto' },
          idempotencyKey: 'order-denied',
        }),
      ).toThrow(/Authorization/)

      expect(fixture.store.countTable('messages')).toBe(before)
      const denied = fixture.store.listAudit(fixture.project.id, 'DENY')
      expect(denied.some((entry) => entry.action === 'message.send')).toBe(true)
    } finally {
      fixture.close()
    }
  })

  it('lets the coordinator send an order and the recipient acknowledge it', () => {
    const fixture = createCoreFixture('C:/msg-order')
    try {
      fixture.approveAndStart()
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      const frontend = fixture.tokens.verify(fixture.tokenFor('frontend'))
      const frontendAgent = fixture.agentByCode.get('frontend')!
      const coordinatorAgent = fixture.agentByCode.get('coordinador')!

      const sent = fixture.service.sendMessage(coordinator, {
        projectId: fixture.project.id,
        toAgentId: frontendAgent.id,
        correlationId: 'corr-order-ok',
        kind: 'ORDER',
        payload: { text: 'implementa' },
        idempotencyKey: 'order-ok',
      })
      expect(sent.message.requiresApproval).toBe(true)
      expect(sent.message.approvedBy).toBe(coordinatorAgent.id)
      expect(sent.message.state).toBe('QUEUED')

      const inbox = fixture.service.listMessages(frontend, fixture.project.id)
      expect(inbox.map((message) => message.id)).toContain(sent.message.id)

      const delivered = fixture.service.deliverMessage(coordinator, sent.message.id, false)
      expect(delivered.state).toBe('DELIVERED')
      const acked = fixture.service.ackMessage(frontend, sent.message.id)
      expect(acked.state).toBe('ACKED')
      const ackedAgain = fixture.service.ackMessage(frontend, sent.message.id)
      expect(ackedAgain.state).toBe('ACKED')
    } finally {
      fixture.close()
    }
  })

  it('delivers ordinary messages only at a safe point', () => {
    const fixture = createCoreFixture('C:/msg-safe')
    try {
      fixture.approveAndStart()
      const coordinator = fixture.tokens.verify(fixture.tokenFor('coordinador'))
      const frontend = fixture.agentByCode.get('frontend')!
      const sent = fixture.service.sendMessage(coordinator, {
        projectId: fixture.project.id,
        toAgentId: frontend.id,
        correlationId: 'corr-safe',
        kind: 'QUERY',
        payload: { text: 'consulta' },
        idempotencyKey: 'safe-1',
      })

      const notDelivered = fixture.service.deliverMessage(coordinator, sent.message.id, false)
      expect(notDelivered.state).toBe('QUEUED')
      const delivered = fixture.service.deliverMessage(coordinator, sent.message.id, true)
      expect(delivered.state).toBe('DELIVERED')
    } finally {
      fixture.close()
    }
  })
})
